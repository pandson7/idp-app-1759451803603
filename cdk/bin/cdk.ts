#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { IdpStack1759451803603 } from '../lib/idp-stack';

const app = new cdk.App();
new IdpStack1759451803603(app, 'IdpStack1759451803603', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
