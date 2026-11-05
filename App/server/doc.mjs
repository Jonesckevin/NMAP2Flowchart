import { HttpError } from './http.mjs';

/**
 * The diagram document every endpoint stores, whatever the scope: an account
 * project, or the one diagram a shared-mode server publishes to everyone.
 */
export function validateDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new HttpError(400, 'Diagram document must be an object');
  }
  if (doc.version !== 2) throw new HttpError(400, 'Unsupported diagram version (expected 2)');
  if (!Array.isArray(doc.nodes)) throw new HttpError(400, 'Diagram document is missing nodes');
  if (!Array.isArray(doc.layers)) throw new HttpError(400, 'Diagram document is missing layers');
  if (doc.edges !== undefined && !Array.isArray(doc.edges)) {
    throw new HttpError(400, 'Diagram document edges must be an array');
  }
  return doc;
}

export function serializeDoc(doc, maxBytes) {
  const docJson = JSON.stringify(doc);
  const bytes = Buffer.byteLength(docJson);
  if (bytes > maxBytes) {
    throw new HttpError(
      413,
      `Diagram is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
    );
  }
  return {
    docJson,
    nodeCount: doc.nodes.length,
    edgeCount: Array.isArray(doc.edges) ? doc.edges.length : 0,
  };
}
