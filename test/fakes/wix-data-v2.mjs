// wix-data.v2 collections: get rejects a missing collection, create makes it (empty).
import { state } from "./state.mjs";

export const collections = {
  async getDataCollection(id) {
    if (!state.collections.has(id)) {
      const e = new Error(`collection ${id} not found`);
      e.code = "WDE0025";
      throw e;
    }
    return { _id: id };
  },
  async createDataCollection(definition) {
    state.createdCollections.push(JSON.parse(JSON.stringify(definition)));
    if (!state.collections.has(definition._id)) state.collections.set(definition._id, new Map());
    return { _id: definition._id };
  }
};
