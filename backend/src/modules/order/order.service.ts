import { prisma } from "../../config/prisma.js";
import { emitAuctionState } from "../../realtime/auctionGateway.js";

export class OrderServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function payCustomerOrder(orderId: string, buyerId: string, include?: any) {
  const paidOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, buyerId } });
    if (!order) throw new OrderServiceError("订单不存在或无权限", 404);
    if (order.status === "CANCELLED") throw new OrderServiceError("订单已取消，无法支付", 409);
    if (order.status !== "PENDING_PAYMENT" && order.status !== "PAID") throw new OrderServiceError("当前订单不需要支付", 409);

    const address = order.addressId
      ? await tx.address.findFirst({ where: { id: order.addressId, userId: buyerId } })
      : await tx.address.findFirst({ where: { userId: buyerId, isDefault: true } }) ?? await tx.address.findFirst({ where: { userId: buyerId }, orderBy: { updatedAt: "desc" } });

    if (!address) throw new OrderServiceError("请先选择或新增收货地址", 409);

    return order.status === "PAID"
      ? tx.order.update({ where: { id: order.id }, data: { addressId: address.id }, include })
      : tx.order.update({ where: { id: order.id }, data: { status: "PAID", addressId: address.id }, include });
  });

  await emitAuctionState(paidOrder.auctionId);
  return paidOrder;
}

export async function assignCustomerOrderAddress(orderId: string, buyerId: string, addressId: string, include?: any) {
  const [order, address] = await Promise.all([
    prisma.order.findFirst({ where: { id: orderId, buyerId } }),
    prisma.address.findFirst({ where: { id: addressId, userId: buyerId } })
  ]);

  if (!order) throw new OrderServiceError("订单不存在或无权限", 404);
  if (!address) throw new OrderServiceError("地址不存在或无权限", 404);
  if (!["PENDING_PAYMENT", "PAID"].includes(order.status)) {
    throw new OrderServiceError("当前订单状态不能修改收货地址", 409);
  }

  return prisma.order.update({
    where: { id: order.id },
    data: { addressId: address.id },
    include
  });
}
