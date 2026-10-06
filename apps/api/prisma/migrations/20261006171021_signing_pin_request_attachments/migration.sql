/*
  Warnings:

  - Added the required column `pinHash` to the `UserKey` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "attachmentFileIds" TEXT[];

-- AlterTable
ALTER TABLE "UserKey" ADD COLUMN     "pinHash" TEXT NOT NULL;
