export default async function teardown(): Promise<void> {
  const server = globalThis.__MOCK_HCM_SERVER__;
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  globalThis.__MOCK_HCM_SERVER__ = undefined;
}
