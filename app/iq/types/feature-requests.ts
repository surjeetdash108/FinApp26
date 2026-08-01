/** Mirrors backend's `feature_requests` collection (src/user-data/feature-requests.controller.ts) — GET/POST /api/feature-requests. */
export interface FeatureRequestDoc {
  id: string;
  uid: string;
  text: string;
  createdAt: string;
}
