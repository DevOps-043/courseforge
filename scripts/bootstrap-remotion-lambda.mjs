import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployFunction, deploySite } from "@remotion/lambda";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const region = process.env.AWS_REGION || "us-east-2";
const accountId = process.env.AWS_ACCOUNT_ID || "535166420267";
const environment = process.env.COURSEFORGE_ENV || "staging";
const siteName =
  process.env.REMOTION_LAMBDA_SITE_NAME || `courseforge-${environment}`;
const bucketName =
  process.env.REMOTION_LAMBDA_BUCKET ||
  `remotionlambda-courseforge-${environment}-${accountId}-${region}`;
const entryPoint =
  process.env.REMOTION_ENTRY_POINT ||
  path.join(repoRoot, "apps", "web", "src", "remotion", "index.ts");

const timeoutInSeconds = Number(process.env.REMOTION_LAMBDA_TIMEOUT || 900);
const memorySizeInMb = Number(process.env.REMOTION_LAMBDA_MEMORY_MB || 2048);
const diskSizeInMb = Number(process.env.REMOTION_LAMBDA_DISK_MB || 2048);
const s3 = new S3Client({ region });

async function ensureBucket() {
  let exists = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`[remotion-lambda] bucket already exists: ${bucketName}`);
    exists = true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status !== 404 && status !== 301 && error?.name !== "NotFound") {
      throw error;
    }
  }

  if (!exists) {
    console.log(`[remotion-lambda] creating bucket: ${bucketName}`);
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration:
          region === "us-east-1" ? undefined : { LocationConstraint: region },
      }),
    );
  }

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: false,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: false,
      },
    }),
  );

  await s3.send(
    new PutBucketEncryptionCommand({
      Bucket: bucketName,
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    }),
  );

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowPublicReadForRemotionSites",
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/sites/*`,
          },
        ],
      }),
    }),
  );
}

console.log("[remotion-lambda] Bootstrap starting");
console.log(`[remotion-lambda] region=${region}`);
console.log(`[remotion-lambda] bucket=${bucketName}`);
console.log(`[remotion-lambda] site=${siteName}`);
console.log(`[remotion-lambda] entryPoint=${entryPoint}`);

const functionResult = await deployFunction({
  region,
  timeoutInSeconds,
  memorySizeInMb,
  diskSizeInMb,
  createCloudWatchLogGroup: true,
  cloudWatchLogRetentionPeriodInDays: 14,
});

console.log(
  `[remotion-lambda] function=${functionResult.functionName} alreadyExisted=${functionResult.alreadyExisted}`,
);

await ensureBucket();

const siteResult = await deploySite({
  region,
  bucketName,
  siteName,
  entryPoint,
  privacy: "no-acl",
  options: {
    onBundleProgress: (progress) => {
      console.log(`[remotion-lambda] bundle=${Math.round(progress)}%`);
    },
    onUploadProgress: ({ filesUploaded, totalFiles }) => {
      console.log(`[remotion-lambda] upload=${filesUploaded}/${totalFiles}`);
    },
  },
});

console.log(`[remotion-lambda] serveUrl=${siteResult.serveUrl}`);
console.log(
  `[remotion-lambda] stats uploaded=${siteResult.stats.uploadedFiles} deleted=${siteResult.stats.deletedFiles} untouched=${siteResult.stats.untouchedFiles}`,
);

console.log("");
console.log("Copy these values to the staging backend environment:");
console.log(`RENDER_PROVIDER=lambda`);
console.log(`REMOTION_LAMBDA_REGION=${region}`);
console.log(`REMOTION_LAMBDA_FUNCTION_NAME=${functionResult.functionName}`);
console.log(`REMOTION_LAMBDA_SERVE_URL=${siteResult.serveUrl}`);
console.log(`REMOTION_LAMBDA_SITE_NAME=${siteResult.siteName}`);
console.log(`REMOTION_LAMBDA_BUCKET=${bucketName}`);
console.log(`REMOTION_LAMBDA_OUTPUT_PRIVACY=private`);
