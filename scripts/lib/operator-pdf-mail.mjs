// The operator sees the complete generated files, independently of writer delivery.
// Private links cover every file; small sets are also attached for direct inspection.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { sendMail } from "./mail.mjs";
import { signedProofUrl } from "./proof-store.mjs";

// Leave ample room for base64, headers and the review report in ordinary inboxes.
export const OPERATOR_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const OPERATOR_LINK_TTL = 7 * 24 * 3600;

export async function sendOperatorPdfNotice({ to, subject, text, assets }, {
  send = sendMail, makeUrl = signedProofUrl, readFile = readFileSync,
  fileInfo = statSync, log = () => {}, maxAttachmentBytes = OPERATOR_ATTACHMENT_BYTES,
} = {}) {
  try {
    if (!Array.isArray(assets) || !assets.length) throw new Error("No generated PDFs to notify");
    const attachments = [], links = [];
    let remaining = maxAttachmentBytes;
    for (const [index, asset] of assets.entries()) {
      if (!asset.key) throw new Error(`PDF ${index + 1} has no private proof key`);
      links.push(`${asset.label}${asset.pages ? ` (${asset.pages} pages)` : ""}\n${makeUrl(asset.key, OPERATOR_LINK_TTL)}`);
      // The uploaded file remains accessible even if its local attachment is unavailable.
      try {
        const size = fileInfo(asset.pdf).size;
        if (size > remaining) continue;
        const content = readFile(asset.pdf);
        if (content.length > remaining) continue;
        attachments.push({ filename: basename(asset.pdf), content });
        remaining -= content.length;
      } catch {
        log(`PDF ${index + 1}: attachment unavailable; private link included`);
      }
    }
    const result = await send({ to, subject, timeoutMs: 20_000, attachments,
      text: `${text}\n\nComplete generated PDFs — private links expire in seven days:\n\n${links.join("\n\n")}\n\n${attachments.length} of ${assets.length} complete PDFs attached. All files are available through the links above; larger files are linked to keep this email small.\n\nThis is your operator copy. It does not confirm delivery to the writer, approve the book or place an order.\n` });
    log(`operator PDF email ${result.dry ? "saved locally" : "accepted"}${result.id ? ` (${result.id})` : ""}; ${assets.length} links, ${attachments.length} attachments`);
    return result;
  } catch {
    // A notification failure must never turn a completed book into a failed press run.
    // Do not log provider response bodies: they may contain recipient or message data.
    log("operator PDF email failed; creator delivery will continue");
    return { ok: false };
  }
}
