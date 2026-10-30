import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// Prisma 7 removed `url` from the schema datasource: the connection string now
// lives here for CLI commands, and the runtime passes a driver adapter instead.
export default defineConfig({
    schema: 'prisma/schema.prisma',
    datasource: {
        url: process.env.DATABASE_URL || 'file:./prisma/lavamusic.db',
    },
});
