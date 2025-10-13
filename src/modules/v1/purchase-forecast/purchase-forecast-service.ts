import { PurchaseForecastRequest, PurchaseForecastSummary, PurchaseOrderRequest, PurchaseOrderResponse, MaterialForecast } from "@pontalti/types/purchase-forecast.types";
import prisma from "@pontalti/lib/prisma";
import materialOrderRepository from "@pontalti/repository/material-order";
import productionControlRepository from "@pontalti/repository/production-control";
import productRecipeRepository from "@pontalti/repository/product-recipe";

const calculatePurchaseForecast = async (filters: PurchaseForecastRequest): Promise<PurchaseForecastSummary> => {
  try {
    const {
      production_control_ids,
      start_date,
      end_date,
      include_stock_buffer = true,
      buffer_percentage = 10
    } = filters;

    // 1. Buscar controles de produção
    let productionControls;
    if (production_control_ids && production_control_ids.length > 0) {
      productionControls = await Promise.all(
        production_control_ids.map(id => productionControlRepository.getProductionControl(id))
      );
    } else {
      // Buscar por período
      const whereClause: any = {};
      if (start_date || end_date) {
        whereClause.OR = [
          {
            estimated_start_date: {
              ...(start_date && { gte: start_date }),
              ...(end_date && { lte: end_date })
            }
          },
          {
            estimated_end_date: {
              ...(start_date && { gte: start_date }),
              ...(end_date && { lte: end_date })
            }
          }
        ];
      }
      
      const result = await productionControlRepository.getProductionControls({ 
        ...whereClause,
        page: 1,
        perPage: 1000 
      });
      productionControls = result.data;
    }

    // 2. Calcular necessidades de materiais
    const materialNeeds = new Map<number, { total_needed: number; material_order_id: number }>();
    
    for (const productionControl of productionControls) {
      if (!productionControl.order?.products) continue;
      
      for (const orderItem of productionControl.order.products) {
        // Buscar receita do produto
        const recipes = await productRecipeRepository.getRecipesByProduct(orderItem.product_id);
        
        for (const recipe of recipes) {
          const materialOrderId = recipe.material_order_id;
          const neededQuantity = recipe.quantity_needed * orderItem.quantity;
          
          if (materialNeeds.has(materialOrderId)) {
            const current = materialNeeds.get(materialOrderId)!;
            current.total_needed += neededQuantity;
          } else {
            materialNeeds.set(materialOrderId, {
              total_needed: neededQuantity,
              material_order_id: materialOrderId
            });
          }
        }
      }
    }

    // 3. Verificar estoque atual e calcular déficit
    const forecasts: MaterialForecast[] = [];
    let totalEstimatedCost = 0;
    let urgentMaterials = 0;

    for (const [materialOrderId, need] of Array.from(materialNeeds.entries())) {
      // Buscar material order
      const materialOrder = await materialOrderRepository.getMaterialOrder(materialOrderId);
      if (!materialOrder) continue;

      // Buscar estoque atual
      const stock = await prisma.stock.findFirst({
        where: { product_id: materialOrder.product.id }
      });
      
      const currentStock = stock?.amount || 0;
      const requiredQuantity = need.total_needed;
      const bufferQuantity = include_stock_buffer ? (requiredQuantity * buffer_percentage / 100) : 0;
      const totalRequired = requiredQuantity + bufferQuantity;
      const shortageQuantity = Math.max(0, totalRequired - currentStock);

      if (shortageQuantity > 0) {
        // Buscar preço médio dos últimos pedidos do mesmo produto
        const recentOrders = await prisma.materialOrders.findMany({
          where: { product_id: materialOrder.product.id },
          orderBy: { created_at: 'desc' },
          take: 5
        });

        // Calcular preço médio (assumindo que MaterialOrders terá um campo de preço no futuro)
        // Por enquanto, usar um valor estimado baseado no histórico
        const estimatedUnitPrice = 10; // Placeholder - deveria vir do histórico
        const estimatedCost = shortageQuantity * estimatedUnitPrice;

        // Determinar prioridade baseada no déficit
        let priority = 3; // Normal
        if (currentStock === 0) priority = 1; // Urgente
        else if (shortageQuantity > requiredQuantity * 0.5) priority = 2; // Alta

        if (priority <= 2) urgentMaterials++;

        const forecast: MaterialForecast = {
          material_order: materialOrder,
          current_stock: currentStock,
          required_quantity: totalRequired,
          shortage_quantity: shortageQuantity,
          estimated_cost: estimatedCost,
          priority,
          expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // +7 dias
        };

        forecasts.push(forecast);
        totalEstimatedCost += estimatedCost;
      }
    }

    return {
      total_estimated_cost: totalEstimatedCost,
      total_materials: forecasts.length,
      urgent_materials: urgentMaterials,
      forecasts: forecasts.sort((a, b) => a.priority - b.priority),
      production_controls: productionControls
    };

  } catch (error) {
    console.error('Error calculating purchase forecast:', error);
    throw error;
  }
};

const createPurchaseOrder = async (data: PurchaseOrderRequest): Promise<PurchaseOrderResponse> => {
  try {
    const { vendor_id, material_orders, justification, priority, created_by } = data;

    // Buscar informações do fornecedor
    const vendor = await prisma.vendors.findUnique({
      where: { id: vendor_id },
      select: { id: true, name: true, store_name: true }
    });

    if (!vendor) {
      throw new Error('Vendor not found');
    }

    // Criar os pedidos de material
    const createdOrders = [];
    let totalEstimatedCost = 0;

    for (const materialOrder of material_orders) {
      const orderData = {
        product_id: materialOrder.product_id,
        vendor_id: vendor_id,
        amount: materialOrder.quantity,
        unit: materialOrder.unit,
        storage_location: materialOrder.storage_location,
        received_by: created_by || 'Sistema',
        date: materialOrder.expected_delivery_date || new Date()
      };

      const createdOrder = await materialOrderRepository.createMaterialOrder(orderData);
      createdOrders.push(createdOrder);

      // Calcular custo estimado (placeholder)
      const estimatedUnitPrice = 10;
      totalEstimatedCost += materialOrder.quantity * estimatedUnitPrice;
    }

    return {
      created_orders: createdOrders,
      total_estimated_cost: totalEstimatedCost,
      vendor,
      summary: {
        total_items: createdOrders.length,
        priority,
        created_at: new Date()
      }
    };

  } catch (error) {
    console.error('Error creating purchase order:', error);
    throw error;
  }
};

export default {
  calculatePurchaseForecast,
  createPurchaseOrder
};
