-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('apple');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerId" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_providerId_key" ON "users"("provider", "providerId");
