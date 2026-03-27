const DEFAULT_API_PORT = 4000;

export function getApiPort() {
  const parsedPort = Number(process.env.PORT);

  if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
    return DEFAULT_API_PORT;
  }

  return parsedPort;
}
