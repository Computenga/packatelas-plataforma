CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- CreateIndex
CREATE INDEX "Order_code_trgm_idx" ON "Order" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Order_recipientName_trgm_idx" ON "Order" USING GIN ("recipientName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Order_addressLine_trgm_idx" ON "Order" USING GIN ("addressLine" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "OrderEvent_type_occurredAt_idx" ON "OrderEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "Order_neighborhood_trgm_idx" ON "Order" USING GIN ("neighborhood" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Order_zip_trgm_idx" ON "Order" USING GIN ("zip" gin_trgm_ops);

