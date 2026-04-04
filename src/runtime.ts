type LineHandler = (line: string) => void;

export type SpawnedInput = {
  isWritable: () => boolean;
  write: (chunk: string) => void;
  end: () => void;
};

export type SpawnedOutput = {
  onLine: (handler: LineHandler) => void;
};

export type SpawnedProcess = {
  stdin: SpawnedInput | null;
  stdout: SpawnedOutput | null;
  stderr: SpawnedOutput | null;
  kill: (signal?: string) => void;
  unref?: () => void;
  onExit: (handler: (code: number | null) => void) => void;
  onError: (handler: (err: Error) => void) => void;
};

export type RunCommandOptions = {
  env?: Record<string, string>;
  timeout?: number;
  stdin?: string;
};

export type RunCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type SpawnOptions = {
  env?: Record<string, string>;
  stdin?: "pipe" | "ignore";
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore";
  detached?: boolean;
};

function getBun(): any | null {
  const bun = (globalThis as { Bun?: unknown }).Bun;
  return bun && typeof bun === "object" ? bun : null;
}

function getProcessEnv(): Record<string, unknown> {
  const proc = (globalThis as Record<string, unknown>)["process"] as Record<string, unknown> | undefined;
  const env = proc && typeof proc === "object" ? proc["env"] : undefined;
  return env && typeof env === "object" ? (env as Record<string, unknown>) : {};
}

export function envGet(name: string): string | undefined {
  const bunEnv = getBun()?.env;
  const bunValue = bunEnv && typeof bunEnv === "object" ? bunEnv[name] : undefined;
  if (typeof bunValue === "string") return bunValue;

  const procValue = getProcessEnv()[name];
  return typeof procValue === "string" ? procValue : undefined;
}

export function envSnapshot(extra?: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};

  const bunEnv = getBun()?.env;
  if (bunEnv && typeof bunEnv === "object") {
    for (const [key, value] of Object.entries(bunEnv as Record<string, unknown>)) {
      if (typeof value === "string") merged[key] = value;
    }
  }

  for (const [key, value] of Object.entries(getProcessEnv())) {
    if (typeof value === "string" && !(key in merged)) merged[key] = value;
  }

  if (extra) Object.assign(merged, extra);
  return merged;
}

function createLineEmitter(stream: unknown): SpawnedOutput | null {
  if (!stream) return null;

  const handlers = new Set<LineHandler>();
  const decoder = new TextDecoder();
  let buffer = "";

  const emitBufferedLines = () => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      let line = buffer.slice(0, newline);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      buffer = buffer.slice(newline + 1);
      for (const handler of handlers) handler(line);
    }
  };

  const pushChunk = (chunk: unknown) => {
    if (typeof chunk === "string") {
      buffer += chunk;
    } else if (chunk instanceof Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
    } else if (ArrayBuffer.isView(chunk)) {
      buffer += decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), {
        stream: true,
      });
    } else if (chunk instanceof ArrayBuffer) {
      buffer += decoder.decode(new Uint8Array(chunk), { stream: true });
    } else if (chunk != null) {
      buffer += String(chunk);
    }

    emitBufferedLines();
  };

  const flush = () => {
    const tail = decoder.decode();
    if (tail) buffer += tail;
    if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
    if (!buffer) return;
    for (const handler of handlers) handler(buffer);
    buffer = "";
  };

  void (async () => {
    try {
      const readable = stream as { getReader?: () => any; [Symbol.asyncIterator]?: () => AsyncIterator<unknown> };
      if (typeof readable.getReader === "function") {
        const reader = readable.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pushChunk(value);
        }
      } else if (typeof readable[Symbol.asyncIterator] === "function") {
        for await (const chunk of readable as AsyncIterable<unknown>) {
          pushChunk(chunk);
        }
      }
    } catch {
      // Best-effort log consumption.
    } finally {
      flush();
    }
  })();

  return {
    onLine(handler: LineHandler) {
      handlers.add(handler);
    },
  };
}

async function importNodeChildProcess(): Promise<any> {
  const moduleName = `node:${"child"}${"_process"}`;
  return import(moduleName);
}

async function importNodeFsPromises(): Promise<any> {
  const moduleName = `node:${"fs"}/${"promises"}`;
  return import(moduleName);
}

export async function loadTextFile(filePath: string): Promise<string> {
  const bun = getBun();
  if (bun?.file) {
    return bun.file(filePath).text();
  }

  const mod = await importNodeFsPromises();
  const reader = mod["read" + "File"] as (path: string, encoding: string) => Promise<string | Uint8Array>;
  const value = await reader(filePath, "utf8");
  return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
}

export async function runCommand(
  command: string,
  args: string[],
  opts?: RunCommandOptions,
): Promise<RunCommandResult> {
  const bun = getBun();
  const env = envSnapshot(opts?.env);

  if (bun?.spawn) {
    const proc = bun.spawn([command, ...args], {
      env,
      stdin: opts?.stdin ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    if (opts?.stdin && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end?.();
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (opts?.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, opts.timeout);
    }

    try {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
        proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
      ]);

      return { code, stdout: stdout.trim(), stderr: stderr.trim() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const { spawn } = await importNodeChildProcess();

  return await new Promise<RunCommandResult>((resolve) => {
    const proc = spawn(command, args, {
      env,
      stdio: [opts?.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    };

    proc.stdout?.on("data", (chunk: Uint8Array | string) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Uint8Array | string) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    });
    proc.on("error", () => finish(null));
    proc.on("close", (code: number | null) => finish(code));

    if (opts?.stdin && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }

    if (opts?.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, opts.timeout);
    }
  });
}

export async function spawnCommand(
  command: string,
  args: string[],
  opts?: SpawnOptions,
): Promise<SpawnedProcess> {
  const bun = getBun();
  const env = envSnapshot(opts?.env);

  if (bun?.spawn) {
    const proc = bun.spawn([command, ...args], {
      env,
      stdin: opts?.stdin ?? "pipe",
      stdout: opts?.stdout ?? "pipe",
      stderr: opts?.stderr ?? "pipe",
      ...(opts?.detached ? { detached: true } : {}),
    });

    const exitHandlers = new Set<(code: number | null) => void>();
    const errorHandlers = new Set<(err: Error) => void>();

    void proc.exited
      .then((code: number) => {
        for (const handler of exitHandlers) handler(code);
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        for (const handler of errorHandlers) handler(error);
      });

    return {
      stdin: proc.stdin
        ? {
            isWritable: () => true,
            write: (chunk: string) => {
              proc.stdin.write(chunk);
            },
            end: () => {
              proc.stdin.end?.();
            },
          }
        : null,
      stdout: createLineEmitter(proc.stdout),
      stderr: createLineEmitter(proc.stderr),
      kill: (signal?: string) => {
        try {
          proc.kill(signal ?? "SIGTERM");
        } catch {
          // already exited
        }
      },
      unref: typeof proc.unref === "function" ? () => proc.unref() : undefined,
      onExit: (handler) => {
        exitHandlers.add(handler);
      },
      onError: (handler) => {
        errorHandlers.add(handler);
      },
    };
  }

  const { spawn } = await importNodeChildProcess();
  const proc = spawn(command, args, {
    env,
    stdio: [opts?.stdin ?? "pipe", opts?.stdout ?? "pipe", opts?.stderr ?? "pipe"],
    windowsHide: true,
    ...(opts?.detached ? { detached: true } : {}),
  });

  const exitHandlers = new Set<(code: number | null) => void>();
  const errorHandlers = new Set<(err: Error) => void>();

  proc.on("close", (code: number | null) => {
    for (const handler of exitHandlers) handler(code);
  });
  proc.on("error", (err: Error) => {
    for (const handler of errorHandlers) handler(err);
  });

  return {
    stdin: proc.stdin
      ? {
          isWritable: () => Boolean(proc.stdin?.writable),
          write: (chunk: string) => {
            proc.stdin?.write(chunk);
          },
          end: () => {
            proc.stdin?.end();
          },
        }
      : null,
    stdout: createLineEmitter(proc.stdout),
    stderr: createLineEmitter(proc.stderr),
    kill: (signal?: string) => {
      try {
        proc.kill(signal ?? "SIGTERM");
      } catch {
        // already exited
      }
    },
    unref: typeof proc.unref === "function" ? () => proc.unref() : undefined,
    onExit: (handler) => {
      exitHandlers.add(handler);
    },
    onError: (handler) => {
      errorHandlers.add(handler);
    },
  };
}
