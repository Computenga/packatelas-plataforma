-- Tienda propia en el portal: productos con fotos, precio normal y de oferta, stock;
-- cada compra genera un pedido de entrega IN-00001 asignable a un repartidor.

-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'TIENDA';

-- AlterTable
ALTER TABLE "StoreOrder" ADD COLUMN     "orderId" TEXT;

-- El precio propio del portal pasa a ser el precio normal.
UPDATE "StoreProduct" SET "price" = "portalPrice" WHERE "portalPrice" IS NOT NULL;

-- AlterTable
ALTER TABLE "StoreProduct" DROP COLUMN "portalPrice",
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "salePrice" DECIMAL(12,2),
ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "wooId" DROP NOT NULL;

-- Los productos que venían de WooCommerce quedan sin existencias hasta capturar su stock.
UPDATE "StoreProduct" SET "inStock" = false;

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_orderId_key" ON "StoreOrder"("orderId");

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
