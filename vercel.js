{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.js",
      "use": "@vercel/node"
    },
    {
      "src": "index.html",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ],
  "env": {
    "FIREBASE_DATABASE_URL": "@firebase_database_url",
    "FIREBASE_PRIVATE_KEY": "@firebase_private_key",
    "FIREBASE_CLIENT_EMAIL": "@firebase_client_email",
    "FIREBASE_PROJECT_ID": "@firebase_project_id",
    "ETHEREUM_RPC_URL": "@ethereum_rpc_url",
    "ETHEREUM_PRIVATE_KEY": "@ethereum_private_key"
  }
}
