import {
  IdentitystoreClient,
  GetUserIdCommand,
  GetGroupMembershipIdCommand,
  DeleteGroupMembershipCommand
} from '@aws-sdk/client-identitystore';
import { getAwsCredentials } from './auth.mjs';
import { randomUUID } from 'node:crypto';

class RetryableError extends Error {
  constructor(message) {
    super(message);
    this.retryable = true;
  }
}

class FatalError extends Error {
  constructor(message) {
    super(message);
    this.retryable = false;
  }
}

async function getUserIdFromUsername(client, identityStoreId, userName) {
  const command = new GetUserIdCommand({
    IdentityStoreId: identityStoreId,
    AlternateIdentifier: {
      UniqueAttribute: {
        AttributePath: 'userName',
        AttributeValue: userName
      }
    }
  });

  try {
    const response = await client.send(command);
    return response.UserId;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      throw new FatalError(`User not found: ${userName}`);
    }
    if (
      error.name === 'ThrottlingException' ||
      error.name === 'ServiceUnavailableException'
    ) {
      throw new RetryableError(
        `AWS service temporarily unavailable: ${error.message}`
      );
    }
    throw new FatalError(
      `Failed to get user ID for ${userName}: ${error.message}`
    );
  }
}

async function removeUserFromGroup(client, identityStoreId, groupId, userId) {
  // First get the membership ID
  const getMembershipCommand = new GetGroupMembershipIdCommand({
    IdentityStoreId: identityStoreId,
    GroupId: groupId,
    MemberId: {
      UserId: userId
    }
  });

  let membershipId;
  try {
    const membershipResponse = await client.send(getMembershipCommand);
    membershipId = membershipResponse.MembershipId;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      // User is not in the group
      console.log('User is not a member of the group');
      return false;
    }
    if (
      error.name === 'ThrottlingException' ||
      error.name === 'ServiceUnavailableException'
    ) {
      throw new RetryableError(
        `AWS service temporarily unavailable: ${error.message}`
      );
    }
    throw new FatalError(`Failed to get membership ID: ${error.message}`);
  }

  // Now delete the membership
  const deleteCommand = new DeleteGroupMembershipCommand({
    IdentityStoreId: identityStoreId,
    MembershipId: membershipId
  });

  try {
    await client.send(deleteCommand);
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      // Membership already deleted
      console.log('Membership already deleted');
      return false;
    }
    if (
      error.name === 'ThrottlingException' ||
      error.name === 'ServiceUnavailableException'
    ) {
      throw new RetryableError(
        `AWS service temporarily unavailable: ${error.message}`
      );
    }
    throw new FatalError(`Failed to remove user from group: ${error.message}`);
  }
}

function validateInputs(params) {
  if (
    !params.userName ||
    typeof params.userName !== 'string' ||
    params.userName.trim() === ''
  ) {
    throw new FatalError('Invalid or missing userName parameter');
  }

  if (
    !params.identityStoreId ||
    typeof params.identityStoreId !== 'string' ||
    params.identityStoreId.trim() === ''
  ) {
    throw new FatalError('Invalid or missing identityStoreId parameter');
  }

  if (
    !params.groupId ||
    typeof params.groupId !== 'string' ||
    params.groupId.trim() === ''
  ) {
    throw new FatalError('Invalid or missing groupId parameter');
  }

  if (
    !params.region ||
    typeof params.region !== 'string' ||
    params.region.trim() === ''
  ) {
    throw new FatalError('Invalid or missing region parameter');
  }
}

function hasBasicAuth(context) {
  return Boolean(
    context.secrets?.BASIC_USERNAME && context.secrets?.BASIC_PASSWORD
  );
}

function hasOAuth2ClientCredentials(context) {
  return Boolean(
    context.environment?.OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID &&
    context.environment?.OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL &&
    context.secrets?.OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET
  );
}

function hasAwsAssumeRoleWebIdentityConfig(context) {
  return Boolean(
    context.environment?.AWS_ASSUME_ROLE_WEB_IDENTITY_REGION &&
    context.environment?.AWS_ASSUME_ROLE_WEB_IDENTITY_ROLE_ARN
  );
}

function buildAwsCredentialsParams(context) {
  if (hasBasicAuth(context)) {
    return {
      basic: {
        username: context.secrets.BASIC_USERNAME,
        password: context.secrets.BASIC_PASSWORD
      }
    };
  }

  if (hasOAuth2ClientCredentials(context)) {
    if (!hasAwsAssumeRoleWebIdentityConfig(context)) {
      throw new FatalError(
        'OAuth2ClientCredentials missing required AwsAssumeRoleWebIdentity configuration'
      );
    }

    return {
      clientCredentials: {
        clientId: context.environment.OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID,
        clientSecret: context.secrets.OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET,
        tokenUrl: context.environment.OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL,
        scope: context.environment.OAUTH2_CLIENT_CREDENTIALS_SCOPE,
        audience: context.environment.OAUTH2_CLIENT_CREDENTIALS_AUDIENCE,
        authStyle: context.environment.OAUTH2_CLIENT_CREDENTIALS_AUTH_STYLE,
        awsConfig: {
          region: context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_REGION,
          roleArn: context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_ROLE_ARN,
          sessionName:
            context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_SESSION_NAME ||
            `sgnl-action-${randomUUID()}`,
          sessionDuration:
            context.environment
              .AWS_ASSUME_ROLE_WEB_IDENTITY_SESSION_DURATION_SECONDS
        }
      }
    };
  }

  throw new FatalError(
    'unsupported auth type: expected Basic or OAuth2ClientCredentials with AwsAssumeRoleWebIdentity'
  );
}

export default {
  /**
   * Main execution handler - removes user from AWS Identity Center group
   * @param {Object} params - Job input parameters
   * @param {string} params.userName - Username of the user to remove from the group
   * @param {string} params.identityStoreId - AWS Identity Store ID
   * @param {string} params.groupId - AWS Identity Center group ID
   * @param {string} params.region - AWS region
   * @param {Object} context - Execution context with env, secrets, outputs
   * @param {string} context.secrets.BASIC_USERNAME - AWS Access Key ID (if using Basic auth)
   * @param {string} context.secrets.BASIC_PASSWORD - AWS Secret Access Key (if using Basic auth)
   * @param {string} context.secrets.OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET - OAuth2 client secret (if using OAuth2 with AssumeRoleWithWebIdentity)
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID - OAuth2 client ID (if using OAuth2)
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL - OAuth2 token URL (if using OAuth2)
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_SCOPE - OAuth2 scope (optional)
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_AUDIENCE - OAuth2 audience (optional)
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_AUTH_STYLE - OAuth2 auth style (optional)
   * @param {string} context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_REGION - AWS region for STS (if using OAuth2)
   * @param {string} context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_ROLE_ARN - AWS role ARN to assume (if using OAuth2)
   * @param {string} context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_SESSION_NAME - Session name (optional, defaults to random UUID)
   * @param {string} context.environment.AWS_ASSUME_ROLE_WEB_IDENTITY_SESSION_DURATION_SECONDS - Session duration in seconds (optional, defaults to 3600)
   * @returns {Object} Removal results
   */
  invoke: async (params, context) => {
    console.log('Starting AWS Remove from Identity Center Group action');

    try {
      validateInputs(params);

      const { userName, identityStoreId, groupId, region } = params;

      console.log(`Processing user: ${userName} for group: ${groupId}`);

      const awsCredentialsParams = buildAwsCredentialsParams(context);

      // Create AWS Identity Store client
      const client = new IdentitystoreClient({
        region: region,
        credentials: await getAwsCredentials(awsCredentialsParams)
      });

      // Get user ID from username
      console.log(`Resolving user ID for username: ${userName}`);
      const userId = await getUserIdFromUsername(
        client,
        identityStoreId,
        userName
      );
      console.log(`Resolved user ID: ${userId}`);

      // Remove user from group
      console.log(`Removing user ${userId} from group ${groupId}`);
      const removed = await removeUserFromGroup(
        client,
        identityStoreId,
        groupId,
        userId
      );

      if (!removed) {
        console.log(`User ${userName} was not a member of group ${groupId}`);
      } else {
        console.log(
          `Successfully removed user ${userName} from group ${groupId}`
        );
      }

      return {
        userName,
        groupId,
        userId,
        removed,
        removedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error removing user from group: ${error.message}`);

      if (error instanceof RetryableError || error instanceof FatalError) {
        throw error;
      }

      throw new FatalError(`Unexpected error: ${error.message}`);
    }
  },

  /**
   * Error recovery handler - handles retryable errors
   * @param {Object} params - Original params plus error information
   * @param {Object} context - Execution context
   * @returns {Object} Recovery results
   */
  error: async (params, _context) => {
    const { error } = params;
    console.error(`Error handler invoked: ${error?.message}`);

    // Re-throw to let framework handle retries
    throw error;
  },

  /**
   * Graceful shutdown handler - performs cleanup
   * @param {Object} params - Original params plus halt reason
   * @param {Object} context - Execution context
   * @returns {Object} Cleanup results
   */
  halt: async (params, _context) => {
    const { reason, userName, groupId } = params;
    console.log(`Job is being halted (${reason})`);

    return {
      userName: userName || 'unknown',
      groupId: groupId || 'unknown',
      reason: reason || 'unknown',
      haltedAt: new Date().toISOString(),
      cleanupCompleted: true
    };
  }
};
