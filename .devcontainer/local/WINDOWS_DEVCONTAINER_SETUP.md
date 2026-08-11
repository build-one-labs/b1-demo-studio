# WSL2 + VS Code + Dev Containers (Windows Guide)

This document describes the **recommended and supported setup** for working with **WSL2**, **Visual Studio Code**, and **Dev Containers** on **Windows**.

Following this guide ensures:
- Fast filesystem access
- Correct VS Code WSL integration
- Reliable Dev Container builds
- No `\\wsl$` network path issues

---

## Requirements

### Windows
- Windows 10 or Windows 11
- **WSL2**
- **Docker Desktop**
- **Visual Studio Code**

> **Important**
> Docker Desktop is **required** on Windows when using VS Code Dev Containers.

### VS Code Extensions
Install in **Windows VS Code**:
- **Remote – WSL**
- **Dev Containers**

---

## 1. Install and Verify WSL2

Install a Linux distribution (Ubuntu recommended).

Verify WSL version:
```powershell
wsl -l -v
```

Your distro must show:
```
  VERSION 2
```

If not, convert it:
```powershell
wsl --set-version <distro-name> 2
```

## 2. Install and Configure Docker Desktop

1. Install Docker Desktop for Windows

2. Open Docker Desktop → Settings

3. **General**
   - Enable **Use WSL 2 based engine**

4. **Resources → WSL Integration**
   - Enable your WSL distro

5. Restart Docker Desktop

6. Verify Docker from WSL:
```bash
docker run hello-world
```

## 3. Install VS Code Extensions

In Windows VS Code, install:
- **Remote – WSL**
- **Dev Containers**

Without **Remote – WSL**, VS Code opens WSL folders via `\\wsl$`, which causes performance problems and Dev Container issues.

## 4. One-Time Setup Inside WSL

1. Open a WSL terminal.

2. Install required tools:
```bash
sudo apt update
sudo apt install -y git
```

3. Create a workspace directory:
```bash
mkdir -p ~/code
```

## 5. Set Up GitHub SSH Authentication (Inside WSL)

GitHub SSH authentication allows you to clone and push to repositories without entering credentials repeatedly.

### Generate SSH Key

1. Generate a new SSH key (use your GitHub email):
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

2. When prompted for file location, press **Enter** to accept default (`~/.ssh/id_ed25519`)

3. Enter a passphrase (recommended) or press **Enter** for no passphrase

### Add SSH Key to SSH Agent

1. Start the SSH agent:
```bash
eval "$(ssh-agent -s)"
```

2. Add your SSH private key:
```bash
ssh-add ~/.ssh/id_ed25519
```

### Add SSH Key to GitHub

1. Copy your public key to clipboard:
```bash
cat ~/.ssh/id_ed25519.pub
```

2. Go to GitHub: **Settings** → **SSH and GPG keys** → **New SSH key**

3. Paste the key and give it a descriptive title (e.g., "WSL2 - Ubuntu")

4. Click **Add SSH key**

### Verify Connection

Test your SSH connection:
```bash
ssh -T git@github.com
```

You should see:
```
Hi <username>! You've successfully authenticated, but GitHub does not provide shell access.
```

### Configure Git

Set your Git identity (use the same email as your SSH key):
```bash
git config --global user.name "Your Name"
git config --global user.email "your_email@example.com"
```

### Auto-Start SSH Agent (Optional)

To automatically start the SSH agent on each WSL session, add to `~/.bashrc`:

```bash
cat >> ~/.bashrc << 'EOL'

# Auto-start SSH agent
if [ -z "$SSH_AUTH_SOCK" ]; then
   eval "$(ssh-agent -s)" > /dev/null
   ssh-add ~/.ssh/id_ed25519 2>/dev/null
fi
EOL
```

Reload your shell:
```bash
source ~/.bashrc
```

### Important Notes

- **SSH keys in WSL are separate from Windows** - You need to generate keys inside WSL
- The dev container mounts your WSL `~/.ssh` directory (read-only) via the devcontainer.json configuration
- Your SSH keys will be available inside the dev container for Git operations
- **Never** copy private keys (`id_ed25519`) - only share public keys (`id_ed25519.pub`)

## 6. Clone the Repository (Inside WSL)

Using SSH (recommended after setting up SSH keys):
```bash
cd ~/code
git clone git@github.com:your-org/repository.git
cd <repository>
```

Or using HTTPS:
```bash
cd ~/code
git clone https://github.com/your-org/repository.git
cd <repository>
```

**Correct Location**
```bash
/home/<user>/code/<repository>
```

**Avoid**
```bash
/mnt/c/...
\\wsl$\...
```

## 7. Open the Repository in VS Code (WSL Mode)

From inside the repository directory:
```bash
code .
```

In VS Code, confirm the bottom-left status shows:
```
WSL: <distro>
```

If not:
- Press **F1** → **WSL: Reopen Folder in WSL**

**Do not** open the repository by navigating to `\\wsl$` in Windows Explorer.

## 8. Configure Environment Secrets

Before starting the dev container, you need to create a `.env.secrets` file in the repository root. This file contains sensitive credentials required by the development environment.

### Create .env.secrets File

The dev container is configured to mount this file and inject the environment variables into the container.

**Required secrets:**

1. Create the file:
```bash
touch .env.secrets
```

2. Edit the file with your secrets (use `nano`, `vim`, or VS Code):
```bash
code .env.secrets
```

3. Add the following required variables:

```bash
# Database Credentials
DEFAULT_DATABASE_CREDENTIALS=username:password

# Users
B1_ADMIN_USER_PASSWORD=your_secure_password
B1_SYSTEM_USER_PASSWORD=your_secure_password

# Authentication & Security
BETTER_AUTH_SECRET=generate_a_secure_random_string_min_32_chars

# Build.One Platform
BUILDONE_TOKEN=your_buildone_api_token
BUILDONE_USER=your_buildone_username

# Stack options (local | remote)
AUTHENTICATION_SERVER_TYPE=local
# Stack options (local | neon)
DATABASE_SERVER_TYPE=local

# CI/CD Integration (Optional)
CIRCLECI_API_TOKEN=your_circleci_token

# AI & Development Tools (Optional)
CLAUDE_ORG_UUID=your_claude_org_uuid
CONTEXT7_API_TOKEN=your_context7_token

# Deployment & Infrastructure (Optional)
PORTAINER_API_TOKEN=your_portainer_token
PORTAINER_URL=your_portainer_url
```

### Important Notes

- **Never commit `.env.secrets` to git** - It's already in `.gitignore`
- **Generate secure values** for passwords and secrets (use a password manager)
- **Obtain tokens** from respective services (GitHub, CircleCI, Portainer, etc.)
- **DEFAULT_DATABASE_CREDENTIALS format**: `username:password` (colon-separated)
- **BETTER_AUTH_SECRET**: Generate using `openssl rand -base64 32` or similar
- Variables marked as "Optional" can be omitted if you don't need those features

### Quick Setup for Development

For local development, you can use these default values to get started quickly:

```bash
# Minimal .env.secrets for development
DEFAULT_DATABASE_CREDENTIALS=build_one:Build.One2021
B1_ADMIN_USER_PASSWORD=Build.One2021
B1_SYSTEM_USER_PASSWORD=Build.One2021
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BUILDONE_TOKEN=development_token
BUILDONE_USER=development
AUTHENTICATION_SERVER_TYPE=local
DATABASE_SERVER_TYPE=local
```

**Note:** These are development-only values. For production deployments, use secure, unique credentials.

## 9. Start the Dev Container

In VS Code:
1. Press **F1** → **Dev Containers: Reopen in Container**

VS Code will:
- Build the container
- Start it
- Reattach the workspace inside the container

The bottom-left indicator should show:
```
Dev Container: <name>
```

## 10. Common Issues and Fixes

### VS Code Opened via `\\wsl$`

**Symptoms**
- Slow performance
- File watcher or hot reload issues

**Fix**
1. Close VS Code
2. Reopen using:
   ```bash
   code .
   ```
   from inside WSL

   or:

   **F1** → **WSL: Reopen Folder in WSL**

### Docker Not Available

**Fix**
1. Ensure Docker Desktop is running
2. Ensure WSL integration is enabled
3. Restart Docker Desktop
4. Rebuild the dev container

### Dev Container Build Fails or Is Inconsistent

**Fix**
- **F1** → **Dev Containers: Rebuild Container**

### SSH Key Not Working in Dev Container

**Symptoms**
- Git operations fail with permission errors
- SSH agent not forwarding

**Fix**
1. Verify SSH keys exist in WSL:
   ```bash
   ls -la ~/.ssh/
   ```

2. Ensure SSH agent is running in WSL:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```

3. Rebuild the dev container to remount SSH directory

### Permission Denied (publickey) Error

**Fix**
1. Verify SSH key is added to GitHub (see section 5)
2. Test connection from WSL:
   ```bash
   ssh -T git@github.com
   ```
3. Ensure you're using SSH clone URL (git@github.com:...) not HTTPS

### Missing .env.secrets File

**Symptoms**
- Dev container fails to start
- Environment variables not available

**Fix**
1. Create `.env.secrets` file in repository root (see section 8)
2. Ensure file is in the correct location (repository root, not `.devcontainer/`)
3. Rebuild the dev container

## 11. Daily Workflow

```bash
wsl
cd ~/code/<repository>
code .
```

Then in VS Code:
- **Dev Containers: Reopen in Container**

## 12. Sanity Checks (Optional)

From the VS Code terminal:
```bash
pwd
```

**Expected paths:**

Before container:
```bash
/home/<user>/code/<repository>
```

Inside container:
```bash
/workspaces/<repository>
```

**Never:**
```bash
/mnt/c/...
```

Verify environment variables are loaded:
```bash
echo $APP_DATABASE_CREDENTIALS
```

Should output the credentials from your `.env.secrets` file.

## Summary / Rules of Thumb

1. Clone repositories **inside WSL**
2. Set up **SSH keys inside WSL** for GitHub authentication
3. Create **`.env.secrets`** file before starting the dev container
4. Open VS Code using `code .` from WSL
5. Ensure VS Code shows **WSL mode**
6. Use **Docker Desktop** as the container engine
7. Avoid `\\wsl$` and `/mnt/c` paths

## Supported Configuration

| Component | Requirement |
|-----------|-------------|
| OS | Windows 10/11 |
| Linux | WSL2 |
| Containers | Docker Desktop |
| Editor | VS Code |
| VS Code Extensions | Remote – WSL, Dev Containers |
| Git Authentication | SSH keys (recommended) or HTTPS |
