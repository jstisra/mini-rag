import { buildApp } from './src/app.js';

const PORT = process.env.PORT || 3000;

const app = await buildApp();
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
