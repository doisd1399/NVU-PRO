import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const viewPath = path.join(root, "src/pages/NewsFeedView.tsx");
const feedPath = path.join(root, "src/pages/NewsFeed.tsx");
const source = fs.readFileSync(viewPath, "utf8");
const feedSource = fs.readFileSync(feedPath, "utf8");
const adminPath = path.join(root, "src/components/admin/CreateNewsModal.tsx");
const adminSource = fs.readFileSync(adminPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function publicationStamp(post: FeedItem)"), "Missing publication timestamp resolver");
assert(source.includes("function publicationLabel(post: FeedItem)"), "Missing publication label resolver");
assert(source.includes("Publicação sem data"), "Ambiguous posts must not receive a fabricated relative age");
assert(source.includes("post?.publishedAt"), "publishedAt must be preferred");
assert(source.includes("post?.published_at"), "published_at legacy alias must be supported");
assert(source.includes("post?.publicadoEm"), "publicadoEm legacy alias must be supported");
assert(source.includes("post?.dataPublicacao"), "dataPublicacao legacy alias must be supported");
assert(source.includes("post?.updatedAt"), "updatedAt must be supported");
assert(source.includes("post?.createdAt"), "createdAt must remain the legacy fallback");
assert(!source.includes("post?.dataReferencia"), "dataReferencia must not be used as publication time");
assert(!source.includes("relativeTime(post?.sortAt"), "sortAt must never be used directly for relative publication time");
assert(!source.includes("publicationTimestamp"), "Legacy publication timestamp resolver must be removed");
assert(!source.includes("sortAt"), "sortAt must not appear in the visual publication component");
assert(!source.includes("Atualizado {publication}"), "publication label must not be duplicated in the card UI");

const resolverStart = source.indexOf("function publicationStamp(post: FeedItem)");
const resolverEnd = source.indexOf("\n}\n\nfunction publicationValue", resolverStart);
assert(resolverStart >= 0 && resolverEnd > resolverStart, "Publication timestamp resolver boundary not found");
const resolver = source.slice(resolverStart, resolverEnd);
assert(!resolver.includes("sortAt"), "sortAt must not appear in publication timestamp resolver");
assert(!resolver.includes("dataReferencia"), "dataReferencia must not appear in publication timestamp resolver");

assert(feedSource.includes("function postTimestamp(post: FeedPost)"), "sortAt ordering helper must remain present");
assert(feedSource.includes("timestampToDate(post.sortAt)"), "sortAt must remain available for feed ordering only");
assert(adminSource.includes("publishedAt: serverTimestamp()"), "new communications must persist publishedAt");
assert(adminSource.includes("sortAt: serverTimestamp()"), "sortAt ordering field must remain available");

console.log("News publication timestamp contract passed");
