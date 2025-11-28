#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "--- Installing nvm and Node.js 18 ---"
# Update package manager (assuming Amazon Linux 2)
sudo yum update -y

# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

# Activate nvm (source it for the current session)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Install Node.js 18
nvm install 18
nvm use 18

echo "--- Installing Verdaccio globally ---"
npm install -g verdaccio

echo "--- Building the Verdaccio Auth VRSE plugin ---"
# Change to the plugin directory
cd verdaccio-auth-vrse

# Install dependencies
npm install

# Build the plugin
npm run build

# Go back to the root directory
cd ..

echo "--- Setting up Verdaccio directories and moving plugin ---"
# Create storage and plugins directories
mkdir -p storage
mkdir -p plugins

# Move the built plugin to the plugins directory
# Ensure the built plugin directory is moved, not just its contents
if [ -d "verdaccio-auth-vrse" ]; then
    mv verdaccio-auth-vrse plugins/
else
    echo "Error: verdaccio-auth-vrse directory not found after build."
    exit 1
fi

echo "--- Starting Verdaccio ---"
# Start verdaccio with the specified config file
# Using 'nohup' and '&' to run in the background
nohup verdaccio --config config.yaml &> verdaccio.log &

echo "Verdaccio started in the background. Check verdaccio.log for output."
echo "You can detach from this session and Verdaccio will continue to run."
echo "To stop Verdaccio, find its process ID (e.g., using 'pgrep verdaccio') and kill it."
