import typer

app = typer.Typer()


@app.command()
def hello():
    print("Hello from AgentMesh CLI")


if __name__ == "__main__":
    app()
