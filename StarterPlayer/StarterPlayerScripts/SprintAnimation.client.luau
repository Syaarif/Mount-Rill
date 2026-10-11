local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local animationId = Config.Stamina.SprintAnimationId
local localPlayer = Players.LocalPlayer

if animationId == "" then
	-- Sprint remains functional without an animation asset.
	return
end

local function bindCharacter(character: Model)
	local humanoid = character:WaitForChild("Humanoid", 5)
	if not humanoid or not humanoid:IsA("Humanoid") then
		return
	end

	local animator = humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = humanoid
	end

	local animation = Instance.new("Animation")
	animation.AnimationId = animationId
	local sprintTrack = animator:LoadAnimation(animation)
	sprintTrack.Priority = Enum.AnimationPriority.Movement

	local function updateAnimation()
		local isSprinting = localPlayer:GetAttribute("MovementState") == "Sprinting"
		if isSprinting then
			if not sprintTrack.IsPlaying then
				sprintTrack:Play(0.15)
			end
		elseif sprintTrack.IsPlaying then
			sprintTrack:Stop(0.15)
		end
	end

	localPlayer:GetAttributeChangedSignal("MovementState"):Connect(updateAnimation)
	updateAnimation()
end

local function bindPlayer(player: Player)
	player.CharacterAdded:Connect(bindCharacter)
	if player.Character then
		bindCharacter(player.Character)
	end
end

for _, player in Players:GetPlayers() do
	bindPlayer(player)
end
Players.PlayerAdded:Connect(bindPlayer)