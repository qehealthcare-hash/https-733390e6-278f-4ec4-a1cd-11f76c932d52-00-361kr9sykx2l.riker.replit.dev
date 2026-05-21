import express from "express";
import crypto from "crypto";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { createSignedDownloadUrl, createSignedUploadUrl } from "../lib/storage.js";

export const uploadRouter = express.Router();

uploadRouter.post(
  "/signed-url",
  requireAuth,
  asyncHandler(async function getSignedUpload(req, res) {
    const bucket = req.body.bucket;
    const fileName = req.body.fileName;
    const objectPath = req.auth.profile.id + "/" + crypto.randomUUID() + "-" + fileName;
    const data = await createSignedUploadUrl(bucket, objectPath);
    res.json({
      success: true,
      data: {
        ...data,
        path: objectPath
      }
    });
  })
);

uploadRouter.post(
  "/download-url",
  requireAuth,
  asyncHandler(async function getSignedDownload(req, res) {
    const data = await createSignedDownloadUrl(req.body.bucket, req.body.path, 3600);
    res.json({ success: true, data });
  })
);
