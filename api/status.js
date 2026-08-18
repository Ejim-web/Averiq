export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.json({
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    network: 'Solana Devnet',
    mint: 'Ff6oxq9jqbhyJTBre56KtXLCuUFKixa6v5EN2qCAXX36'
  });
}
