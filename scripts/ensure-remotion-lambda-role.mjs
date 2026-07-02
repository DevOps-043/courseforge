import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { getRolePolicy } from "@remotion/lambda";

const roleName = process.env.REMOTION_LAMBDA_ROLE_NAME || "remotion-lambda-role";
const policyName =
  process.env.REMOTION_LAMBDA_ROLE_POLICY_NAME || "remotion-lambda-policy";

const iam = new IAMClient({});

const assumeRolePolicyDocument = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: {
        Service: "lambda.amazonaws.com",
      },
      Action: "sts:AssumeRole",
    },
  ],
});

async function roleExists() {
  try {
    const role = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    return role.Role?.Arn;
  } catch (error) {
    if (error?.name === "NoSuchEntityException") {
      return null;
    }

    throw error;
  }
}

let roleArn = await roleExists();

if (!roleArn) {
  console.log(`[remotion-lambda] Creating IAM role ${roleName}`);
  const created = await iam.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: assumeRolePolicyDocument,
      Description: "Execution role for Remotion Lambda renders.",
      Tags: [
        { Key: "app", Value: "courseforge" },
        { Key: "component", Value: "remotion-lambda" },
      ],
    }),
  );
  roleArn = created.Role?.Arn;
} else {
  console.log(`[remotion-lambda] IAM role already exists: ${roleName}`);
}

console.log(`[remotion-lambda] Updating inline policy ${policyName}`);
await iam.send(
  new PutRolePolicyCommand({
    RoleName: roleName,
    PolicyName: policyName,
    PolicyDocument: getRolePolicy(),
  }),
);

console.log(`[remotion-lambda] roleArn=${roleArn}`);
console.log(
  "[remotion-lambda] Waiting 20 seconds for IAM trust policy propagation",
);
await new Promise((resolve) => setTimeout(resolve, 20_000));
