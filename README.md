# AWS Remove from Identity Center Group Action

Remove a user from an AWS Identity Center (formerly AWS SSO) group. This action is commonly used for access revocation, offboarding workflows, or security incident responses involving AWS Identity Center managed access.

## Overview

This SGNL action integrates with the AWS Identity Store API to remove users from AWS Identity Center groups. When executed, the action resolves the user ID from the username, finds the group membership, and removes the user from the specified group.

## Prerequisites

- AWS account with AWS Identity Center enabled
- Appropriate authentication credentials (Basic auth or OAuth2 with AssumeRoleWithWebIdentity)
- `identitystore:GetUserId`, `identitystore:GetGroupMembershipId`, and `identitystore:DeleteGroupMembership` permissions
- AWS Identity Center Identity Store ID
- Group ID to remove user from

## Configuration

### Required Secrets

The configured auth type will determine which secrets are needed:

- **Basic Authentication**: `BASIC_USERNAME` (AWS Access Key ID) and `BASIC_PASSWORD` (AWS Secret Access Key)
- **OAuth2 with AssumeRoleWithWebIdentity**: `OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET`

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID` | - | OAuth2 client ID |
| `OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL` | - | OAuth2 token endpoint URL |
| `OAUTH2_CLIENT_CREDENTIALS_SCOPE` | - | OAuth2 scope (optional) |
| `OAUTH2_CLIENT_CREDENTIALS_AUDIENCE` | - | OAuth2 audience (optional) |
| `OAUTH2_CLIENT_CREDENTIALS_AUTH_STYLE` | - | OAuth2 auth style: `in_params` or `in_header` (optional) |
| `AWS_ASSUME_ROLE_WEB_IDENTITY_REGION` | - | AWS region for AssumeRoleWithWebIdentity |
| `AWS_ASSUME_ROLE_WEB_IDENTITY_ROLE_ARN` | - | ARN of the AWS role to assume |
| `AWS_ASSUME_ROLE_WEB_IDENTITY_SESSION_NAME` | Auto-generated | Session name for AssumeRoleWithWebIdentity |
| `AWS_ASSUME_ROLE_WEB_IDENTITY_SESSION_DURATION_SECONDS` | 3600 | Session duration in seconds (900-43200) |

### Input Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `userName` | string | Yes | Username of the user to remove (Identity Center username attribute) | `jdoe@example.com` |
| `identityStoreId` | string | Yes | AWS Identity Store ID | `d-8b77564492` |
| `groupId` | string | Yes | AWS Identity Center group ID (UUID) | `910b05d1-11f1-71ea-8ced-62ab45188f93` |
| `region` | string | Yes | AWS region where Identity Center is configured | `us-east-2` |

### Output Structure

| Field | Type | Description |
|-------|------|-------------|
| `userName` | string | Username of the user |
| `groupId` | string | Group ID the user was removed from |
| `userId` | string | Resolved AWS Identity Center user ID (UUID) |
| `removed` | boolean | Whether the user was removed (false if not a member) |
| `removedAt` | string | When the removal was processed (ISO 8601) |

## Usage Example

### Job Request

```json
{
  "id": "remove-user-001",
  "type": "nodejs-20",
  "script": {
    "repository": "github.com/sgnl-actions/aws-remove-from-identity-center-group",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "userName": "jdoe@example.com",
    "identityStoreId": "d-8b77564492",
    "groupId": "910b05d1-11f1-71ea-8ced-62ab45188f93",
    "region": "us-east-2"
  }
}
```

### Successful Response

```json
{
  "userName": "jdoe@example.com",
  "groupId": "910b05d1-11f1-71ea-8ced-62ab45188f93",
  "userId": "61eb35b0-f0c1-709d-750e-93b3da2e4a2d",
  "removed": true,
  "removedAt": "2024-01-15T10:30:01Z"
}
```

### User Not in Group Response

```json
{
  "userName": "jdoe@example.com",
  "groupId": "910b05d1-11f1-71ea-8ced-62ab45188f93",
  "userId": "61eb35b0-f0c1-709d-750e-93b3da2e4a2d",
  "removed": false,
  "removedAt": "2024-01-15T10:30:01Z"
}
```

## Authentication Methods

This action supports multiple authentication methods:

### 1. Basic Authentication (Static Credentials)
Use AWS Access Key ID and Secret Access Key directly:
```json
"secrets": {
  "BASIC_USERNAME": "AKIAIOSFODNN7EXAMPLE",
  "BASIC_PASSWORD": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}
```

### 2. OAuth2 with AssumeRoleWithWebIdentity (Recommended)
Use OAuth2 Client Credentials flow to obtain an OIDC token, then assume an AWS role. This provides temporary credentials that are more secure:

```json
"secrets": {
  "OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET": "your-client-secret"
},
"environment": {
  "OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID": "your-client-id",
  "OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL": "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
  "OAUTH2_CLIENT_CREDENTIALS_SCOPE": "api://aud/.default",
  "AWS_ASSUME_ROLE_WEB_IDENTITY_REGION": "us-east-2",
  "AWS_ASSUME_ROLE_WEB_IDENTITY_ROLE_ARN": "arn:aws:iam::123456789012:role/MyRole"
}
```

**How it works:**
1. Obtains OAuth2 access token using client credentials
2. Calls AWS STS `AssumeRoleWithWebIdentity` with the token
3. Receives temporary AWS credentials (access key, secret, session token)
4. Uses temporary credentials to call AWS Identity Store APIs

## Error Handling

The action includes comprehensive error handling:

### Successful Cases
- **200 OK + removed: true**: User successfully removed from group
- **200 OK + removed: false**: User was not a member of the group (idempotent)

### Error Cases
- **ResourceNotFoundException (User)**: User not found in Identity Center
- **ResourceNotFoundException (Group)**: Group not found or user not in group
- **AccessDeniedException**: Insufficient Identity Store permissions
- **InvalidClientTokenId**: Invalid AWS credentials
- **ThrottlingException**: Rate limit exceeded (retryable)
- **ServiceUnavailableException**: AWS service temporarily unavailable (retryable)

## IAM Permissions Required

The AWS credentials (or assumed role) must have the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "identitystore:GetUserId",
        "identitystore:GetGroupMembershipId",
        "identitystore:DeleteGroupMembership"
      ],
      "Resource": "*"
    }
  ]
}
```

## Development

### Local Testing

```bash
# Install dependencies
npm install

# Run tests
npm test

# Test locally with mock data
npm run dev

# Build for production
npm run build
```

### Running Tests

The action includes comprehensive unit tests covering:
- Input validation (userName, identityStoreId, groupId, region)
- Successful user removal
- User not in group (idempotent)
- Both authentication methods (Basic and AssumeRoleWithWebIdentity)
- Error handling (user not found, invalid credentials, etc.)

```bash
# Run all tests (29 tests)
npm test

# Run tests in watch mode
npm run test:watch

# Check test coverage
npm run test:coverage

# Validate metadata schema
npm run validate
```

## Security Considerations

- **Credential Protection**: Never log or expose AWS credentials or OAuth tokens
- **Audit Logging**: All group membership removals are logged with timestamps
- **Input Validation**: All parameters are validated before API calls
- **Temporary Credentials**: AssumeRoleWithWebIdentity provides time-limited credentials
- **Least Privilege**: Use IAM policies to restrict Identity Store access
- **Idempotent Operations**: Removing a user already not in a group succeeds without error

## AWS API Reference

This action uses the following AWS Identity Store API endpoints:
- [GetUserId](https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_GetUserId.html)
- [GetGroupMembershipId](https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_GetGroupMembershipId.html)
- [DeleteGroupMembership](https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_DeleteGroupMembership.html)

And for AssumeRoleWithWebIdentity authentication:
- [AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)

## Troubleshooting

### Common Issues

1. **"Invalid or missing userName parameter"**
   - Ensure the `userName` parameter is provided and is a non-empty string
   - The userName should match the Identity Center username attribute (often email)

2. **"Invalid or missing identityStoreId parameter"**
   - Ensure the `identityStoreId` parameter is provided (format: `d-xxxxxxxxxx`)
   - Find your Identity Store ID in the AWS Identity Center console

3. **"Invalid or missing groupId parameter"**
   - Ensure the `groupId` parameter is provided (UUID format)
   - Find group IDs using the AWS CLI: `aws identitystore list-groups --identity-store-id d-xxxxxxxxxx`

4. **"Invalid or missing region parameter"**
   - Ensure the `region` parameter is provided (e.g., `us-east-2`)
   - Identity Center is typically configured in a specific region

5. **"User not found: username"**
   - Verify the username exists in AWS Identity Center
   - Check that the username attribute matches (case-sensitive)
   - Ensure you're using the correct Identity Store ID

6. **Authentication Errors (AccessDeniedException)**
   - Verify your AWS credentials are valid and haven't expired
   - Ensure the credentials have required Identity Store permissions
   - For AssumeRoleWithWebIdentity, verify the trust policy allows your OIDC provider

7. **"OAuth2ClientCredentials missing required AwsAssumeRoleWebIdentity configuration"**
   - When using OAuth2, you must provide AWS AssumeRoleWithWebIdentity environment variables
   - Ensure `AWS_ASSUME_ROLE_WEB_IDENTITY_REGION` and `AWS_ASSUME_ROLE_WEB_IDENTITY_ROLE_ARN` are set

8. **"Failed to assume AWS role with web identity"**
   - Verify the IAM role's trust policy allows your OIDC provider
   - Check that the OAuth2 token is valid and has the correct audience
   - Ensure the role ARN is correct

## Related Actions

- **[aws-add-to-identity-center-group](https://github.com/sgnl-actions/aws-add-to-identity-center-group)** - Add users to AWS Identity Center groups
- **[aws-revoke-session](https://github.com/sgnl-actions/aws-revoke-session)** - Revoke AWS IAM role sessions

## License

MIT

## Support

For issues or questions, please contact SGNL Engineering or create an issue in this repository.
