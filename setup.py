from setuptools import setup, find_packages

setup(
    name="ai-agent-inventory-sdk",
    version="0.1.0",
    packages=find_packages(include=["ai_agent_inventory", "ai_agent_inventory.*"]),
    install_requires=["openai>=1.0", "httpx>=0.24"],
    extras_require={"anthropic": ["anthropic>=0.20"]},
    python_requires=">=3.10",
)
