/**
 * NewTaskModal Component
 * Modal dialog for creating new tasks
 */

import React, { useState, useRef, useEffect } from 'react';
import type { CreateTaskRequest, TopologyType } from '../types/task';

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTaskRequest) => Promise<void>;
  loading?: boolean;
}

interface AgentConfig {
  id: string;
  name: string;
  role: string;
}

export function NewTaskModal({
  isOpen,
  onClose,
  onSubmit,
  loading = false,
}: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topology, setTopology] = useState<TopologyType>('swarm');
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus title input when modal opens
  useEffect(() => {
    if (isOpen) {
      titleInputRef.current?.focus();
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setDescription('');
      setTopology('swarm');
      setAgents([]);
      setError(null);
    }
  }, [isOpen]);

  const handleAddAgent = () => {
    const newAgent: AgentConfig = {
      id: crypto.randomUUID(),
      name: '',
      role: '',
    };
    setAgents([...agents, newAgent]);
  };

  const handleRemoveAgent = (id: string) => {
    setAgents(agents.filter((a) => a.id !== id));
  };

  const handleAgentChange = (
    id: string,
    field: 'name' | 'role',
    value: string
  ) => {
    setAgents(
      agents.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!title.trim()) {
      setError('Task title is required');
      return;
    }

    setError(null);

    const data: CreateTaskRequest = {
      title: title.trim(),
      description: description.trim() || undefined,
      topology,
      agents: agents
        .filter((a) => a.name.trim() && a.role.trim())
        .map((a) => ({ name: a.name.trim(), role: a.role.trim() })),
    };

    try {
      await onSubmit(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      ref={modalRef}
      onClick={handleBackdropClick}
    >
      <div className="modal glass-panel">
        <div className="modal-header">
          <h2>Create New Task</h2>
          <button
            className="btn btn-icon"
            onClick={onClose}
            disabled={loading}
            title="Close"
          >
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && (
            <div className="form-error">
              <span className="error-icon">!</span>
              {error}
            </div>
          )}

          {/* Title */}
          <div className="form-group">
            <label htmlFor="task-title">Title *</label>
            <input
              ref={titleInputRef}
              id="task-title"
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter task title"
              disabled={loading}
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="task-description">Description</label>
            <textarea
              id="task-description"
              className="form-input form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the task objectives"
              rows={3}
              disabled={loading}
            />
          </div>

          {/* Topology */}
          <div className="form-group">
            <label>Topology</label>
            <div className="topology-options">
              <label
                className={`topology-option ${
                  topology === 'swarm' ? 'topology-option-selected' : ''
                }`}
              >
                <input
                  type="radio"
                  name="topology"
                  value="swarm"
                  checked={topology === 'swarm'}
                  onChange={(e) =>
                    setTopology(e.target.value as TopologyType)
                  }
                  disabled={loading}
                />
                <div className="topology-content">
                  <span className="topology-icon">🐝</span>
                  <div className="topology-info">
                    <span className="topology-name">Swarm</span>
                    <span className="topology-desc">
                      Parallel execution with result aggregation
                    </span>
                  </div>
                </div>
              </label>
              <label
                className={`topology-option ${
                  topology === 'squad' ? 'topology-option-selected' : ''
                }`}
              >
                <input
                  type="radio"
                  name="topology"
                  value="squad"
                  checked={topology === 'squad'}
                  onChange={(e) =>
                    setTopology(e.target.value as TopologyType)
                  }
                  disabled={loading}
                />
                <div className="topology-content">
                  <span className="topology-icon">👥</span>
                  <div className="topology-info">
                    <span className="topology-name">Squad</span>
                    <span className="topology-desc">
                      Hierarchical team with leader coordination
                    </span>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Agents */}
          <div className="form-group">
            <div className="form-group-header">
              <label>Agents (optional)</label>
              <button
                type="button"
                className="btn btn-small"
                onClick={handleAddAgent}
                disabled={loading}
              >
                + Add Agent
              </button>
            </div>
            {agents.length > 0 && (
              <div className="agents-form-list">
                {agents.map((agent, index) => (
                  <div key={agent.id} className="agent-form-item">
                    <span className="agent-form-number">{index + 1}</span>
                    <input
                      type="text"
                      className="form-input"
                      value={agent.name}
                      onChange={(e) =>
                        handleAgentChange(agent.id, 'name', e.target.value)
                      }
                      placeholder="Agent name"
                      disabled={loading}
                    />
                    <input
                      type="text"
                      className="form-input"
                      value={agent.role}
                      onChange={(e) =>
                        handleAgentChange(agent.id, 'role', e.target.value)
                      }
                      placeholder="Role (e.g., Frontend, Backend)"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="btn btn-icon btn-danger"
                      onClick={() => handleRemoveAgent(agent.id)}
                      disabled={loading}
                      title="Remove agent"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  Creating...
                </>
              ) : (
                'Create Task'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewTaskModal;
