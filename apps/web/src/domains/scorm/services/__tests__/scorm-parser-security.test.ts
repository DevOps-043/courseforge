import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { ScormParserService } from "../scorm-parser.service";

test("parses a small valid SCORM manifest", async () => {
  const zip = new JSZip();
  zip.file("imsmanifest.xml", `
    <manifest>
      <metadata><schemaversion>1.2</schemaversion></metadata>
      <organizations><organization identifier="org"><title>Safe course</title></organization></organizations>
      <resources></resources>
    </manifest>
  `);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const manifest = await new ScormParserService().parsePackage(buffer);
  assert.equal(manifest.title, "Safe course");
});

test("rejects an entry with an excessive compression ratio before extraction", async () => {
  const zip = new JSZip();
  zip.file("imsmanifest.xml", "A".repeat(2 * 1024 * 1024));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await assert.rejects(
    () => new ScormParserService().parsePackage(buffer),
    /processing budget/,
  );
});
