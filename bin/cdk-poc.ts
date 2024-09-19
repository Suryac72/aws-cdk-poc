#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CdkPocStack } from "../lib/cdk-poc-stack";

const app = new cdk.App();
new CdkPocStack(app, "CdkPocStack", {
  env: {
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION,
  },
});
