import { IdentitystoreClient, GetUserIdCommand, GetGroupMembershipIdCommand, DeleteGroupMembershipCommand } from '@aws-sdk/client-identitystore';

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
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      throw new RetryableError(`AWS service temporarily unavailable: ${error.message}`);
    }
    throw new FatalError(`Failed to get user ID for ${userName}: ${error.message}`);
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
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      throw new RetryableError(`AWS service temporarily unavailable: ${error.message}`);
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
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      throw new RetryableError(`AWS service temporarily unavailable: ${error.message}`);
    }
    throw new FatalError(`Failed to remove user from group: ${error.message}`);
  }
}

function validateInputs(params) {
  if (!params.userName || typeof params.userName !== 'string' || params.userName.trim() === '') {
    throw new FatalError('Invalid or missing userName parameter');
  }

  if (!params.identityStoreId || typeof params.identityStoreId !== 'string' || params.identityStoreId.trim() === '') {
    throw new FatalError('Invalid or missing identityStoreId parameter');
  }

  if (!params.groupId || typeof params.groupId !== 'string' || params.groupId.trim() === '') {
    throw new FatalError('Invalid or missing groupId parameter');
  }

  if (!params.region || typeof params.region !== 'string' || params.region.trim() === '') {
    throw new FatalError('Invalid or missing region parameter');
  }
}

export default {
  invoke: async (params, context) => {
    console.log('Starting AWS Remove from Identity Center Group action');

    try {
      validateInputs(params);

      const { userName, identityStoreId, groupId, region } = params;

      console.log(`Processing user: ${userName} for group: ${groupId}`);

      if (!context.secrets?.AWS_ACCESS_KEY_ID || !context.secrets?.AWS_SECRET_ACCESS_KEY) {
        throw new FatalError('Missing required AWS credentials in secrets');
      }

      // Create AWS Identity Store client
      const client = new IdentitystoreClient({
        region: region,
        credentials: {
          accessKeyId: context.secrets.AWS_ACCESS_KEY_ID,
          secretAccessKey: context.secrets.AWS_SECRET_ACCESS_KEY
        }
      });

      // Get user ID from username
      console.log(`Resolving user ID for username: ${userName}`);
      const userId = await getUserIdFromUsername(client, identityStoreId, userName);
      console.log(`Resolved user ID: ${userId}`);

      // Remove user from group
      console.log(`Removing user ${userId} from group ${groupId}`);
      const removed = await removeUserFromGroup(client, identityStoreId, groupId, userId);

      const result = {
        userName,
        groupId,
        userId,
        removed,
        removedAt: new Date().toISOString()
      };

      if (!removed) {
        console.log(`User ${userName} was not a member of group ${groupId}`);
      } else {
        console.log(`Successfully removed user ${userName} from group ${groupId}`);
      }

      return result;

    } catch (error) {
      console.error(`Error removing user from group: ${error.message}`);

      if (error instanceof RetryableError || error instanceof FatalError) {
        throw error;
      }

      throw new FatalError(`Unexpected error: ${error.message}`);
    }
  },

  error: async (params, _context) => {
    const { error } = params;
    console.error(`Error handler invoked: ${error?.message}`);

    // Re-throw to let framework handle retries
    throw error;
  },

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