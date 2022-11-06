module.export = {
  branches: [
    {
      name: "main",
    },
    {
      name: "beta",
      prerelease: true,
    },
    {
      name: "alpha",
      prerelease: true,
    },
  ],
  release: {
    plugins: [
      [
        "@semantic-release/commit-analyzer",
        {
          releaseRules: [
            {
              scope: "no-release",
              release: false,
            },
            {
              breaking: true,
              release: "major",
            },
            {
              type: "feat",
              release: "minor",
            },
            {
              type: "refactor",
              scope: "core-*",
              release: "minor",
            },
            {
              type: "*",
              release: "patch",
            },
          ],
        },
      ],
      "@semantic-release/release-notes-generator",
      "@semantic-release/npm",
    ],
  },
};