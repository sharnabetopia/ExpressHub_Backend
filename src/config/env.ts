import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT ?? 5000),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  DATABASE_URL: process.env.DATABASE_URL ?? "",
};

if (!env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Create a .env file with your PostgreSQL connection string.");
}
