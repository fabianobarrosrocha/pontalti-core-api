import * as yup from "yup";
import { Router } from "express";
import locationService from "./location-service";
import { locationSchema, locationUpdateSchema, locationPositionUpdateSchema } from "./location-schema";
import { validate } from "@pontalti/utils/validator";
import createHttpError from "http-errors";
import prisma from "@pontalti/lib/prisma";

const router = Router();

// Dashboard data endpoint - must be before /:id to avoid conflict
router.get("/dashboard/data", async (req, res, next) => {
  try {
    const locations = await locationService.getLocationsWithDetails();

    // Get active production orders
    const productionControls = await prisma.productionControl.findMany({
      where: {
        status: { in: [1, 2] } // Planning or In Production
      },
      include: {
        order: {
          include: {
            customer: {
              select: { id: true, name: true, store_name: true }
            },
            products: {
              include: {
                product: {
                  select: { id: true, sku: true, type: true, inner_color: true, outer_color: true, foam: true, mold: true }
                }
              }
            }
          }
        }
      }
    });

    res.json({
      data: {
        locations,
        productionControls
      }
    });
  } catch(e) {
    next(createHttpError(e));
  }
});

// Batch update positions (for drag-and-drop)
router.patch("/positions/batch", (req, res, next) => {
  const updates = req.body.updates || [];
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "Updates array is required" });
  }
  locationService.updatePositions(updates)
    .then(() => res.json({ success: true }))
    .catch(e => next(createHttpError(e)));
});

router.post("/", validate(yup.object({ body: locationSchema })), (req, res, next) => {
  locationService.createLocation(req.body)
    .then(location => res.status(201).json(location))
    .catch(e => next(createHttpError(e)));
});

router.get("/", (req, res, next) => {
  locationService.getLocations(req.query)
    .then(locations => res.json(locations))
    .catch(e => next(createHttpError(e)));
});

router.get("/:id", (req, res, next) => {
  locationService.getLocation(Number(req.params.id))
    .then(location => {
      if (!location) return res.status(404).json({ error: "Location not found" });
      res.json(location);
    })
    .catch(e => next(createHttpError(e)));
});

router.patch("/:id", validate(yup.object({ body: locationUpdateSchema })), (req, res, next) => {
  locationService.updatePartialLocation(Number(req.params.id), req.body)
    .then(location => res.json(location))
    .catch(e => next(createHttpError(e)));
});

router.delete("/:id", (req, res, next) => {
  locationService.deleteLocation(Number(req.params.id))
    .then(location => res.json(location))
    .catch(e => next(createHttpError(e)));
});

export default router;
