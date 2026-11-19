// The shopping trip module's only public interface. A shopping trip is the
// planned meals a shopping list covers and how their ingredient lines map to
// list items; the aisle list groups the list by aisle for the shop. Every
// trip and aisle-list write goes through here. Callers authorize and lock.

export {
  type AisleList,
  aisleList,
  checkAisleGroup,
  generateAisleList,
} from "./aisle-list";
export { checkCapacity } from "./capacity";
export { type ShoppingTrip, tripIsStale } from "./demands";
export {
  applyTrip,
  clearList,
  plannedMeals,
  previewTrip,
  removeListItem,
} from "./trip";
