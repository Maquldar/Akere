-- CreateIndex
CREATE INDEX "Document_pdfFileId_idx" ON "Document"("pdfFileId");

-- CreateIndex
CREATE INDEX "Document_signedPdfFileId_idx" ON "Document"("signedPdfFileId");

-- CreateIndex
CREATE INDEX "FileVersion_storedFileId_idx" ON "FileVersion"("storedFileId");

-- CreateIndex
CREATE INDEX "Request_attachmentFileIds_idx" ON "Request" USING GIN ("attachmentFileIds");

-- CreateIndex
CREATE INDEX "RouteStep_actedById_idx" ON "RouteStep"("actedById");

-- CreateIndex
CREATE INDEX "SickLeave_fileId_idx" ON "SickLeave"("fileId");

-- CreateIndex
CREATE INDEX "TimeMark_selfieFileId_idx" ON "TimeMark"("selfieFileId");
