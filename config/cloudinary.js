import { v2 as cloudinary } from "cloudinary";
import { env } from "./env.js";

export const cloudinaryEnabled =
  env.storageDriver === "cloudinary" && Boolean(env.cloudName && env.cloudApiKey && env.cloudApiSecret);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.cloudName,
    api_key: env.cloudApiKey,
    api_secret: env.cloudApiSecret,
    secure: true,
  });
}

export default cloudinary;
