import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './api/server.js';
const port = Number(process.env.PORT) || 3001;
const app = createApp();
app.listen(port, () => {
    console.log(`Coreline v2 API running on port ${port}`);
});
//# sourceMappingURL=index.js.map