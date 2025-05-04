import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Environment types
interface Env {
  SLACK_BOT_TOKEN: string;
  SLACK_TEAM_ID: string;
  SLACK_CHANNEL_IDS?: string;
}

// Slack client class to handle API interactions
class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };
  private teamId: string;
  private channelIds?: string;

  constructor(botToken: string, teamId: string, channelIds?: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
    this.teamId = teamId;
    this.channelIds = channelIds;
  }

  async getChannels(limit: number = 100, cursor?: string): Promise<any> {
    const predefinedChannelIds = this.channelIds;
    if (!predefinedChannelIds) {
      const params = new URLSearchParams({
        types: "public_channel",
        exclude_archived: "true",
        limit: Math.min(limit, 200).toString(),
        team_id: this.teamId,
      });

      if (cursor) {
        params.append("cursor", cursor);
      }

      const response = await fetch(
        `https://slack.com/api/conversations.list?${params}`,
        { headers: this.botHeaders }
      );

      return response.json();
    }

    const predefinedChannelIdsArray = predefinedChannelIds
      .split(",")
      .map((id: string) => id.trim());
    const channels = [];

    for (const channelId of predefinedChannelIdsArray) {
      const params = new URLSearchParams({
        channel: channelId,
      });

      const response = await fetch(
        `https://slack.com/api/conversations.info?${params}`,
        { headers: this.botHeaders }
      );
      const responseData = await response.json();

      interface SlackChannelResponse {
        ok: boolean;
        channel?: {
          is_archived?: boolean;
          [key: string]: any;
        };
      }

      const data = responseData as SlackChannelResponse;
      if (data.ok && data.channel && !data.channel.is_archived) {
        channels.push(data.channel);
      }
    }

    return {
      ok: true,
      channels: channels,
      response_metadata: { next_cursor: "" },
    };
  }

  async postMessage(channel_id: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        text: text,
      }),
    });

    return response.json();
  }

  async postReply(
    channel_id: string,
    thread_ts: string,
    text: string
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        thread_ts: thread_ts,
        text: text,
      }),
    });

    return response.json();
  }

  async addReaction(
    channel_id: string,
    timestamp: string,
    reaction: string
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        timestamp: timestamp,
        name: reaction,
      }),
    });

    return response.json();
  }

  async getChannelHistory(
    channel_id: string,
    limit: number = 10
  ): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      limit: limit.toString(),
    });

    const response = await fetch(
      `https://slack.com/api/conversations.history?${params}`,
      { headers: this.botHeaders }
    );

    return response.json();
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      ts: thread_ts,
    });

    const response = await fetch(
      `https://slack.com/api/conversations.replies?${params}`,
      { headers: this.botHeaders }
    );

    return response.json();
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      limit: Math.min(limit, 200).toString(),
      team_id: this.teamId,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: this.botHeaders,
    });

    return response.json();
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({
      user: user_id,
      include_labels: "true",
    });

    const response = await fetch(
      `https://slack.com/api/users.profile.get?${params}`,
      { headers: this.botHeaders }
    );

    return response.json();
  }
}

// Define our Slack MCP agent with tools
export class SlackMCP extends McpAgent {
  private slackClient: SlackClient;

  server = new McpServer({
    name: "Slack MCP Server",
    version: "1.0.0",
  });

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    const botToken = env.SLACK_BOT_TOKEN;
    const teamId = env.SLACK_TEAM_ID;
    const channelIds = env.SLACK_CHANNEL_IDS;

    if (!botToken || !teamId) {
      throw new Error(
        "SLACK_BOT_TOKEN and SLACK_TEAM_ID environment variables are required"
      );
    }

    this.slackClient = new SlackClient(botToken, teamId, channelIds);
  }

  async init() {
    // List channels tool
    this.server.tool(
      "slack_list_channels",
      {
        limit: z
          .number()
          .optional()
          .describe(
            "Maximum number of channels to return (default 100, max 200)"
          ),
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor for next page of results"),
      },
      async ({ limit, cursor }) => {
        const response = await this.slackClient.getChannels(limit, cursor);
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Post message tool
    this.server.tool(
      "slack_post_message",
      {
        channel_id: z.string().describe("The ID of the channel to post to"),
        text: z.string().describe("The message text to post"),
      },
      async ({ channel_id, text }) => {
        const response = await this.slackClient.postMessage(channel_id, text);
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Reply to thread tool
    this.server.tool(
      "slack_reply_to_thread",
      {
        channel_id: z
          .string()
          .describe("The ID of the channel containing the thread"),
        thread_ts: z
          .string()
          .describe(
            "The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it."
          ),
        text: z.string().describe("The reply text"),
      },
      async ({ channel_id, thread_ts, text }) => {
        const response = await this.slackClient.postReply(
          channel_id,
          thread_ts,
          text
        );
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Add reaction tool
    this.server.tool(
      "slack_add_reaction",
      {
        channel_id: z
          .string()
          .describe("The ID of the channel containing the message"),
        timestamp: z
          .string()
          .describe("The timestamp of the message to react to"),
        reaction: z
          .string()
          .describe("The name of the emoji reaction (without ::)"),
      },
      async ({ channel_id, timestamp, reaction }) => {
        const response = await this.slackClient.addReaction(
          channel_id,
          timestamp,
          reaction
        );
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Get channel history tool
    this.server.tool(
      "slack_get_channel_history",
      {
        channel_id: z.string().describe("The ID of the channel"),
        limit: z
          .number()
          .optional()
          .describe("Number of messages to retrieve (default 10)"),
      },
      async ({ channel_id, limit }) => {
        const response = await this.slackClient.getChannelHistory(
          channel_id,
          limit
        );
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Get thread replies tool
    this.server.tool(
      "slack_get_thread_replies",
      {
        channel_id: z
          .string()
          .describe("The ID of the channel containing the thread"),
        thread_ts: z
          .string()
          .describe(
            "The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it."
          ),
      },
      async ({ channel_id, thread_ts }) => {
        const response = await this.slackClient.getThreadReplies(
          channel_id,
          thread_ts
        );
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Get users tool
    this.server.tool(
      "slack_get_users",
      {
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor for next page of results"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of users to return (default 100, max 200)"),
      },
      async ({ limit, cursor }) => {
        const response = await this.slackClient.getUsers(limit, cursor);
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    // Get user profile tool
    this.server.tool(
      "slack_get_user_profile",
      {
        user_id: z.string().describe("The ID of the user"),
      },
      async ({ user_id }) => {
        const response = await this.slackClient.getUserProfile(user_id);
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return SlackMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return SlackMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
