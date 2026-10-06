-- Registration numbers are unique per legal entity + document type (L1).
-- NULL numbers (unregistered drafts) are distinct in PostgreSQL unique indexes, so this is equivalent to a
-- partial unique index WHERE "number" IS NOT NULL while staying representable in schema.prisma (no drift).
CREATE UNIQUE INDEX "Document_legalEntityId_documentTypeId_number_key" ON "Document"("legalEntityId", "documentTypeId", "number");
