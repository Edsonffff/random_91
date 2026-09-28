import app from '../api/index';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[Lottery Simulator Mock API Server] running on http://localhost:${PORT}`);
  console.log(`Matching SaaS Imperial Merchant API endpoints:`);
  console.log(`  POST   /api/merchant/token`);
  console.log(`  POST   /merchant/api/set_merchant_custom_result.php`);
  console.log(`  GET    /merchant/api/get_merchant_custom_results.php`);
  console.log(`  GET    /api/test/current-period`);
  console.log(`Live WinGo 30S Proxy endpoints:`);
  console.log(`  GET    /api/real/current`);
  console.log(`  GET    /api/real/history`);
  console.log(`  GET    /api/real/history/export?format=csv|json`);
});

export default app;
