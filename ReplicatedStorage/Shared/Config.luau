local Config = {
	GameName = "Mount Rill",

	Basecamp = {
		SpawnName = "BasecampSpawn",
		StartingCheckpoint = "Basecamp",
	},

	Stamina = {
		MaxStamina = 100,
		StartingStamina = 100,
		SprintDrainRate = 20,
		JumpCost = 4,
		RecoveryRate = 14,
		RegenDelay = 1.5,
		SprintSpeedMultiplier = 1.625,
		SprintResumeThreshold = 20,
		SpeedPenaltyThreshold = 50,
		MinimumSpeedMultiplier = 0.6,
		UpdateInterval = 0.2,
		BaseWalkSpeed = 16,
		DebugSprint = true,
		SprintAnimationId = "rbxassetid://89831383041183",
	},

	Hydration = {
		MaxHydration = 100,
		WalkingDrainRate = 0.10,
		SprintingDrainRate = 0.22,
		LowHydrationThreshold = 30,
		LowHydrationStaminaRegenMultiplier = 0.8,
		RefillAmount = 100,
		RefillCooldown = 2,
		UpdateInterval = 0.5,
	},

	Energy = {
		MaxEnergy = 100,
		RestRecoveryRate = 8,
		RestUpdateInterval = 0.5,
	},

	EnvironmentalCondition = {
		DefaultTemperature = "Temperate",
		DefaultTerrain = "Trail",
		DefaultStaminaDrainMultiplier = 1,
		DefaultHydrationDrainMultiplier = 1,
		DefaultEnergyDrainMultiplier = 1,
		ConditionUpdateInterval = 0.5,
	},

	Interaction = {
		WaterRefillTag = "MountRillWaterRefill",
		RestAreaTag = "MountRillRestArea",
		ObstacleTag = "MountRillObstacle",
		ObstacleDuration = 3,
		RestDistance = 12,
	},

	Weather = {
		StartingState = "Clear",
		StateChangeInterval = 0,
		States = {
			Clear = {
				StaminaDrainMultiplier = 1,
				HydrationDrainMultiplier = 1,
				EnergyDrainMultiplier = 1,
			},
			Cloudy = {
				StaminaDrainMultiplier = 1,
				HydrationDrainMultiplier = 1,
				EnergyDrainMultiplier = 1,
			},
			Rain = {
				StaminaDrainMultiplier = 1.1,
				HydrationDrainMultiplier = 0.9,
				EnergyDrainMultiplier = 1.1,
			},
		},
	},

	CheckpointSystem = {
		FolderName = "MountRillCheckpoints",
		Checkpoints = {
			{ Name = "Basecamp", PartName = "BasecampCheckpoint", SpawnName = "BasecampSpawn" },
			{ Name = "Pos 1", PartName = "Pos1Checkpoint", SpawnName = "Pos1Spawn" },
			{ Name = "Pos 2", PartName = "Pos2Checkpoint", SpawnName = "Pos2Spawn" },
			{ Name = "Pos 3", PartName = "Pos3Checkpoint", SpawnName = "Pos3Spawn" },
			{ Name = "Pos 4", PartName = "Pos4Checkpoint", SpawnName = "Pos4Spawn" },
			{ Name = "Summit", PartName = "SummitCheckpoint", SpawnName = "SummitSpawn" },
		},
	},

	PlayerDefaults = {
		Hydration = 100,
		Energy = 100,
		Checkpoint = "Basecamp",
		RillTokens = 0,
	},
}

return Config