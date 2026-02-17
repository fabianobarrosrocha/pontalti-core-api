import locationRepository from "@pontalti/repository/location";
import { LocationRegister, LocationRequest, UpdatePartialLocation, LocationPositionUpdate } from "@pontalti/types/location.types";

const createLocation = async (data: LocationRegister) => {
  return locationRepository.createLocation(data);
};

const getLocation = async (id: number) => {
  return locationRepository.getLocation(id);
};

const getLocations = async (filters: LocationRequest) => {
  return locationRepository.getLocations(filters);
};

const getLocationsWithDetails = async () => {
  return locationRepository.getLocationsWithDetails();
};

const updatePartialLocation = async (id: number, data: UpdatePartialLocation) => {
  return locationRepository.updatePartialLocation(id, data);
};

const deleteLocation = async (id: number) => {
  return locationRepository.deleteLocation(id);
};

const updatePositions = async (updates: LocationPositionUpdate[]) => {
  return locationRepository.updatePositions(updates);
};

export default {
  createLocation,
  getLocation,
  getLocations,
  getLocationsWithDetails,
  updatePartialLocation,
  deleteLocation,
  updatePositions
};
