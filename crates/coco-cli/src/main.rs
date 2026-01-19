use coco_core::task::CreateTaskRequest;
use coco_core::task::TaskTopology;
use coco_orchestrator::Orchestrator;
use clap::Args;
use clap::Parser;
use clap::Subcommand;
use clap::ValueEnum;
use directories::ProjectDirs;
use std::path::Path;
use std::path::PathBuf;

const EXIT_CODE_NOT_FOUND: u8 = 3;
const EXIT_CODE_USAGE: u8 = 2;
const EXIT_CODE_TIMEOUT: u8 = 4;

#[derive(Debug, thiserror::Error)]
enum CliError {
    #[error("{0}")]
    Store(#[from] coco_core::task_store::TaskStoreError),
    #[error("{0}")]
    Orchestrator(#[from] coco_orchestrator::OrchestratorError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not determine app data directory")]
    AppDataUnavailable,
    #[error("invalid task id: {task_id}")]
    InvalidTaskId { task_id: String },
    #[error("json encode error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Parser, Debug)]
#[command(
    name = "coco",
    version,
    about = "Coco CLI (MVP: tasks + events)"
)]
struct Cli {
    /// Output JSON (stable structure) for programmatic consumption.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Task {
        #[command(subcommand)]
        command: TaskCommand,
    },
    Subagent {
        #[command(subcommand)]
        command: SubagentCommand,
    },
}

#[derive(Subcommand, Debug)]
enum TaskCommand {
    Create(TaskCreateArgs),
    List(TaskListArgs),
    Show(TaskShowArgs),
    Events(TaskEventsArgs),
}

#[derive(Subcommand, Debug)]
enum SubagentCommand {
    Spawn(SubagentSpawnArgs),
    List(SubagentListArgs),
    WaitAny(SubagentWaitAnyArgs),
    Cancel(SubagentCancelArgs),
}

#[derive(Args, Debug)]
struct TaskCreateArgs {
    #[arg(long)]
    title: String,

    #[arg(long)]
    topology: TopologyArg,

    #[arg(long, default_value = "")]
    description: String,
}

#[derive(Args, Debug)]
struct TaskListArgs {}

#[derive(Args, Debug)]
struct TaskShowArgs {
    task_id: String,
}

#[derive(Args, Debug)]
struct TaskEventsArgs {
    task_id: String,

    #[arg(long, default_value_t = 50)]
    limit: usize,

    #[arg(long, default_value_t = 0)]
    offset: usize,

    #[arg(long)]
    type_prefix: Option<String>,
}

#[derive(Args, Debug)]
struct SubagentSpawnArgs {
    task_id: String,

    #[arg(long)]
    instance: String,

    #[arg(long)]
    agent: String,

    /// Worker execution directory (defaults to current directory).
    #[arg(long, default_value = ".")]
    cwd: PathBuf,

    /// Codex binary to use (defaults to `codex` on PATH).
    #[arg(long, default_value = "codex")]
    codex_bin: PathBuf,

    /// Prompt passed to `codex exec`.
    prompt: String,
}

#[derive(Args, Debug)]
struct SubagentListArgs {
    task_id: String,
}

#[derive(Args, Debug)]
struct SubagentWaitAnyArgs {
    task_id: String,

    /// Override timeout in seconds (defaults to `task.yaml.config.timeoutSeconds`).
    #[arg(long)]
    timeout_seconds: Option<u32>,
}

#[derive(Args, Debug)]
struct SubagentCancelArgs {
    task_id: String,
    agent_instance: String,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum TopologyArg {
    Swarm,
    Squad,
}

impl From<TopologyArg> for TaskTopology {
    fn from(value: TopologyArg) -> Self {
        match value {
            TopologyArg::Swarm => TaskTopology::Swarm,
            TopologyArg::Squad => TaskTopology::Squad,
        }
    }
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            std::process::ExitCode::from(exit_code_for_error(&err))
        }
    }
}

fn run() -> Result<(), CliError> {
    let cli = Cli::parse();

    let workspace_root = resolve_workspace_root()?;
    let orchestrator = Orchestrator::new(workspace_root);

    match cli.command {
        Commands::Task { command } => match command {
            TaskCommand::Create(args) => cmd_task_create(&orchestrator, cli.json, args),
            TaskCommand::List(args) => cmd_task_list(&orchestrator, cli.json, args),
            TaskCommand::Show(args) => cmd_task_show(&orchestrator, cli.json, args),
            TaskCommand::Events(args) => cmd_task_events(&orchestrator, cli.json, args),
        },
        Commands::Subagent { command } => match command {
            SubagentCommand::Spawn(args) => cmd_subagent_spawn(&orchestrator, cli.json, args),
            SubagentCommand::List(args) => cmd_subagent_list(&orchestrator, cli.json, args),
            SubagentCommand::WaitAny(args) => cmd_subagent_wait_any(&orchestrator, cli.json, args),
            SubagentCommand::Cancel(args) => cmd_subagent_cancel(&orchestrator, cli.json, args),
        },
    }
}

fn cmd_task_create(
    orchestrator: &Orchestrator,
    json: bool,
    args: TaskCreateArgs,
) -> Result<(), CliError> {
    let req = CreateTaskRequest {
        title: args.title,
        description: args.description,
        topology: args.topology.into(),
        milestones: Vec::new(),
        roster: Vec::new(),
        config: None,
    };
    let resp = orchestrator.create_task(req)?;

    if json {
        println!("{}", serde_json::to_string(&resp)?);
        return Ok(());
    }

    println!("{}", resp.id);
    Ok(())
}

fn cmd_task_list(
    orchestrator: &Orchestrator,
    json: bool,
    _args: TaskListArgs,
) -> Result<(), CliError> {
    let tasks = orchestrator.list_tasks()?;

    if json {
        println!("{}", serde_json::to_string(&tasks)?);
        return Ok(());
    }

    for task in tasks {
        println!(
            "{}\t{}\t{}",
            task.id,
            format_task_state(task.state),
            task.title
        );
    }
    Ok(())
}

fn cmd_task_show(
    orchestrator: &Orchestrator,
    json: bool,
    args: TaskShowArgs,
) -> Result<(), CliError> {
    validate_task_id(&args.task_id)?;
    let task = orchestrator.get_task(&args.task_id)?;

    if json {
        println!("{}", serde_json::to_string(&task)?);
        return Ok(());
    }

    println!("id: {}", task.id);
    println!("title: {}", task.title);
    if !task.description.trim().is_empty() {
        println!("description: {}", task.description);
    }
    println!("topology: {}", format_task_topology(task.topology));
    println!("state: {}", format_task_state(task.state));
    println!("createdAt: {}", task.created_at.to_rfc3339());
    println!("updatedAt: {}", task.updated_at.to_rfc3339());
    println!("milestones: {}", task.milestones.len());
    println!("roster: {}", task.roster.len());
    println!("gates: {}", task.gates.len());
    Ok(())
}

fn cmd_task_events(
    orchestrator: &Orchestrator,
    json: bool,
    args: TaskEventsArgs,
) -> Result<(), CliError> {
    validate_task_id(&args.task_id)?;
    // Ensure consistent exit code when the task id does not exist.
    let _ = orchestrator.get_task(&args.task_id)?;

    let events = orchestrator.get_task_events(
        &args.task_id,
        args.type_prefix.as_deref(),
        args.limit,
        args.offset,
    )?;

    if json {
        println!("{}", serde_json::to_string(&events)?);
        return Ok(());
    }

    for event in events {
        let by = event.by.as_deref().unwrap_or("-");
        println!("{}\t{}\tby={}", event.ts.to_rfc3339(), event.event_type, by);
    }
    Ok(())
}

fn cmd_subagent_spawn(
    orchestrator: &Orchestrator,
    json: bool,
    args: SubagentSpawnArgs,
) -> Result<(), CliError> {
    validate_task_id(&args.task_id)?;
    // Ensure consistent exit code when the task id does not exist.
    let _ = orchestrator.get_task(&args.task_id)?;

    let output_schema_path = default_output_schema_path(orchestrator.workspace_root());

    let resp = orchestrator.subagent_spawn(coco_orchestrator::SubagentSpawnRequest {
        task_id: args.task_id,
        agent_instance: args.instance,
        agent: args.agent,
        prompt: args.prompt,
        cwd: args.cwd,
        codex_bin: args.codex_bin,
        output_schema_path,
    })?;

    if json {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "agentInstance": resp.agent_instance,
                "pid": resp.pid,
            }))?
        );
        return Ok(());
    }

    println!("{}\tpid={}", resp.agent_instance, resp.pid);
    Ok(())
}

fn cmd_subagent_list(
    orchestrator: &Orchestrator,
    json: bool,
    args: SubagentListArgs,
) -> Result<(), CliError> {
    validate_task_id(&args.task_id)?;
    // Ensure consistent exit code when the task id does not exist.
    let _ = orchestrator.get_task(&args.task_id)?;

    let subagents = orchestrator.subagent_list(&args.task_id)?;

    if json {
        let value = subagents
            .iter()
            .map(|a| {
                serde_json::json!({
                    "agentInstance": a.agent_instance,
                    "agent": a.agent,
                    "status": a.status.as_str(),
                })
            })
            .collect::<Vec<_>>();
        println!("{}", serde_json::to_string(&value)?);
        return Ok(());
    }

    for a in subagents {
        println!("{}\t{}\t{}", a.agent_instance, a.status.as_str(), a.agent);
    }
    Ok(())
}

fn cmd_subagent_wait_any(
    orchestrator: &Orchestrator,
    json: bool,
    args: SubagentWaitAnyArgs,
) -> Result<(), CliError> {
    validate_task_id(&args.task_id)?;
    // Ensure consistent exit code when the task id does not exist.
    let _ = orchestrator.get_task(&args.task_id)?;

    let result = orchestrator.subagent_wait_any(&args.task_id, args.timeout_seconds)?;

    if json {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "agentInstance": result.agent_instance,
                "status": result.status.as_str(),
            }))?
        );
        return Ok(());
    }

    println!("{}\t{}", result.agent_instance, result.status.as_str());
    Ok(())
}

fn cmd_subagent_cancel(
    orchestrator: &Orchestrator,
    json: bool,
    args: SubagentCancelArgs,
) -> Result<(), CliError> {
    validate_task_id(&args.task_id)?;
    // Ensure consistent exit code when the task id does not exist.
    let _ = orchestrator.get_task(&args.task_id)?;

    orchestrator.subagent_cancel(&args.task_id, &args.agent_instance)?;

    if json {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "agentInstance": args.agent_instance,
                "cancelled": true,
            }))?
        );
        return Ok(());
    }

    println!("cancelled\t{}", args.agent_instance);
    Ok(())
}

fn resolve_workspace_root() -> Result<PathBuf, CliError> {
    if let Ok(root) = std::env::var("COCO_WORKSPACE_ROOT") {
        let path = PathBuf::from(root);
        std::fs::create_dir_all(&path)?;
        return Ok(path);
    }

    // Dev convenience: if running from the repo, keep state in the repo workspace root.
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.join("../..");
        if repo_root.join(".coco").exists() {
            return Ok(repo_root);
        }
    }

    let project_dirs =
        ProjectDirs::from("dev", "coco", "coco").ok_or(CliError::AppDataUnavailable)?;
    let path = project_dirs.data_dir().join("workspace");
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

fn validate_task_id(task_id: &str) -> Result<(), CliError> {
    let is_ok = !task_id.is_empty()
        && task_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if is_ok {
        Ok(())
    } else {
        Err(CliError::InvalidTaskId {
            task_id: task_id.to_string(),
        })
    }
}

fn exit_code_for_error(err: &CliError) -> u8 {
    match err {
        CliError::Store(coco_core::task_store::TaskStoreError::TaskNotFound { .. }) => {
            EXIT_CODE_NOT_FOUND
        }
        CliError::Orchestrator(coco_orchestrator::OrchestratorError::Store(
            coco_core::task_store::TaskStoreError::TaskNotFound { .. },
        )) => EXIT_CODE_NOT_FOUND,
        CliError::Orchestrator(coco_orchestrator::OrchestratorError::SubagentNotFound {
            ..
        }) => EXIT_CODE_NOT_FOUND,
        CliError::Orchestrator(coco_orchestrator::OrchestratorError::WaitAnyTimeout {
            ..
        }) => EXIT_CODE_TIMEOUT,
        CliError::InvalidTaskId { .. } => EXIT_CODE_USAGE,
        _ => 1,
    }
}

fn default_output_schema_path(workspace_root: &Path) -> PathBuf {
    let candidate = workspace_root
        .join("schemas")
        .join("worker-output.schema.json");
    if candidate.exists() {
        return candidate;
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("schemas")
        .join("worker-output.schema.json")
}

fn format_task_topology(topology: TaskTopology) -> &'static str {
    match topology {
        TaskTopology::Swarm => "swarm",
        TaskTopology::Squad => "squad",
    }
}

fn format_task_state(state: coco_core::task::TaskState) -> &'static str {
    match state {
        coco_core::task::TaskState::Created => "created",
        coco_core::task::TaskState::Working => "working",
        coco_core::task::TaskState::InputRequired => "input-required",
        coco_core::task::TaskState::Completed => "completed",
        coco_core::task::TaskState::Failed => "failed",
        coco_core::task::TaskState::Canceled => "canceled",
    }
}
