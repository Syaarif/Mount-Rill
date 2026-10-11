local HttpService = game:GetService("HttpService")
local LogService = game:GetService("LogService")
local Selection = game:GetService("Selection")
local RunService = game:GetService("RunService")

local ENDPOINT = "http://127.0.0.1:38741/bridge/snapshot"
local PROTOCOL_VERSION = 1
local MAX_INSTANCES = 1500
local MAX_DEPTH = 16
local POLL_INTERVAL = 1

local toolbar = plugin:CreateToolbar("Mount Rill")
local toolbarButton = toolbar:CreateButton(
	"MountRillStudioBridge",
	"Connect the read-only Mount Rill MCP bridge",
	""
)

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Float,
	false,
	false,
	360,
	160,
	320,
	120
)
local widget = plugin:CreateDockWidgetPluginGuiAsync("MountRillStudioBridge", widgetInfo)
widget.Title = "Mount Rill Studio Bridge (Read Only)"

local frame = Instance.new("Frame")
frame.Name = "Container"
frame.BackgroundTransparency = 1
frame.Size = UDim2.fromScale(1, 1)
frame.Parent = widget

local tokenBox = Instance.new("TextBox")
tokenBox.Name = "BridgeToken"
tokenBox.PlaceholderText = "Paste the local bridge token (not saved)"
tokenBox.ClearTextOnFocus = false
tokenBox.Text = ""
tokenBox.TextSize = 14
tokenBox.Size = UDim2.new(1, -16, 0, 34)
tokenBox.Position = UDim2.fromOffset(8, 8)
tokenBox.Parent = frame

local connectButton = Instance.new("TextButton")
connectButton.Name = "Connect"
connectButton.Text = "Connect (read only)"
connectButton.TextSize = 14
connectButton.Size = UDim2.new(1, -16, 0, 34)
connectButton.Position = UDim2.fromOffset(8, 50)
connectButton.Parent = frame

local statusLabel = Instance.new("TextLabel")
statusLabel.Name = "Status"
statusLabel.BackgroundTransparency = 1
statusLabel.Text = "Disconnected. No Studio data is shared until you connect."
statusLabel.TextSize = 13
statusLabel.TextWrapped = true
statusLabel.TextXAlignment = Enum.TextXAlignment.Left
statusLabel.Size = UDim2.new(1, -16, 0, 52)
statusLabel.Position = UDim2.fromOffset(8, 94)
statusLabel.Parent = frame

local connected = false
local bridgeToken = nil

local function setStatus(message)
	statusLabel.Text = string.sub(message, 1, 280)
end

local function serializeValue(value)
	local valueType = typeof(value)
	if valueType == "string" then
		return string.sub(value, 1, 500)
	elseif valueType == "number" then
		if value == value and math.abs(value) < math.huge then
			return value
		end
		return nil
	elseif valueType == "boolean" then
		return value
	elseif valueType == "Vector3" then
		return { x = value.X, y = value.Y, z = value.Z }
	elseif valueType == "Vector2" then
		return { x = value.X, y = value.Y }
	elseif valueType == "Color3" then
		return { r = value.R, g = value.G, b = value.B }
	elseif valueType == "UDim2" then
		return {
			xScale = value.X.Scale,
			xOffset = value.X.Offset,
			yScale = value.Y.Scale,
			yOffset = value.Y.Offset,
		}
	elseif valueType == "EnumItem" then
		return tostring(value)
	elseif valueType == "Instance" then
		return value.Name
	end
	return nil
end

local function readAllowedProperties(instance)
	local names = {}
	if instance:IsA("BasePart") then
		names = { "Anchored", "CanCollide", "Color", "Material", "Position", "Size", "Transparency" }
	elseif instance:IsA("GuiObject") then
		names = { "BackgroundTransparency", "LayoutOrder", "Position", "Size", "Visible" }
	elseif instance:IsA("Humanoid") then
		names = { "Health", "MaxHealth", "WalkSpeed" }
	elseif instance:IsA("ValueBase") then
		names = { "Value" }
	elseif instance:IsA("Sound") then
		names = { "Playing", "SoundId", "Volume" }
	elseif instance:IsA("Model") then
		names = { "PrimaryPart" }
	elseif instance:IsA("Light") then
		names = { "Enabled" }
	end

	local properties = {}
	for _, name in ipairs(names) do
		local success, value = pcall(function()
			return instance[name]
		end)
		if success then
			local serialized = serializeValue(value)
			if serialized ~= nil then
				properties[name] = serialized
			end
		end
	end
	return properties
end

local function makeInstanceRecord(instance, id, parentId)
	local success, fullName = pcall(function()
		return instance:GetFullName()
	end)
	return {
		id = id,
		parentId = parentId,
		name = string.sub(instance.Name, 1, 120),
		className = string.sub(instance.ClassName, 1, 100),
		path = string.sub(success and fullName or instance.Name, 1, 1024),
		properties = readAllowedProperties(instance),
	}
end

local function buildHierarchy()
	local hierarchy = {}
	local idByInstance = {}
	local nextId = 0
	local visit

	visit = function(instance, parentId, depth)
		if #hierarchy >= MAX_INSTANCES or depth > MAX_DEPTH then
			return
		end
		nextId += 1
		local id = nextId
		idByInstance[instance] = id
		table.insert(hierarchy, makeInstanceRecord(instance, id, parentId))

		local success, children = pcall(function()
			return instance:GetChildren()
		end)
		if not success then
			return
		end
		for _, child in ipairs(children) do
			if #hierarchy >= MAX_INSTANCES then
				return
			end
			visit(child, id, depth + 1)
		end
	end

	for _, child in ipairs(game:GetChildren()) do
		if #hierarchy >= MAX_INSTANCES then
			break
		end
		visit(child, nil, 0)
	end

	local selection = {}
	for _, instance in ipairs(Selection:Get()) do
		local id = idByInstance[instance]
		if id then
			local parent = instance.Parent
			table.insert(selection, makeInstanceRecord(instance, id, parent and idByInstance[parent] or nil))
		end
	end

	return hierarchy, selection
end

local function readLogs()
	local success, history = pcall(function()
		return LogService:GetLogHistory()
	end)
	if not success then
		return false, tostring(history), {}
	end

	local logs = {}
	local first = math.max(1, #history - 99)
	for index = first, #history do
		local item = history[index]
		table.insert(logs, {
			message = string.sub(tostring(item.message or ""), 1, 2000),
			messageType = string.sub(tostring(item.messageType or "Unknown"), 1, 64),
			timestamp = tonumber(item.timestamp) or 0,
		})
	end
	return true, nil, logs
end

local function makeSnapshot()
	local hierarchy, selection = buildHierarchy()
	local logsAvailable, logsError, logs = readLogs()
	return {
		protocolVersion = PROTOCOL_VERSION,
		sentAt = os.time() * 1000,
		studio = {
			name = string.sub(game.Name, 1, 128),
			gameId = tostring(game.GameId),
			placeId = tostring(game.PlaceId),
			isRunning = RunService:IsRunning(),
		},
		hierarchy = hierarchy,
		selection = selection,
		logsAvailable = logsAvailable,
		logsError = logsError and string.sub(logsError, 1, 300) or nil,
		logs = logs,
	}
end

local function sendSnapshot()
	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = ENDPOINT,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Authorization"] = "Bearer " .. bridgeToken,
			},
			Body = HttpService:JSONEncode(makeSnapshot()),
		})
	end)

	if not success then
		setStatus("Bridge request failed. Check the local server and Studio HTTP/plugin permissions.")
		warn("[Mount Rill Studio Bridge] Local request failed: " .. tostring(response))
		return false
	end
	if response.StatusCode ~= 200 then
		setStatus("Bridge rejected the snapshot (HTTP " .. tostring(response.StatusCode) .. ").")
		return false
	end

	setStatus("Connected. Read-only snapshot sent; refreshing every second.")
	return true
end

local function disconnect()
	connected = false
	bridgeToken = nil
	tokenBox.Text = ""
	connectButton.Text = "Connect (read only)"
	setStatus("Disconnected. No Studio data is being shared.")
end

local function connect()
	local token = string.gsub(tokenBox.Text, "^%s*(.-)%s*$", "%1")
	if #token < 32 or #token > 128 or string.find(token, "[^%w_%-]") then
		setStatus("Token must be 32-128 URL-safe characters.")
		return
	end

	bridgeToken = token
	tokenBox.Text = ""
	connected = true
	connectButton.Text = "Disconnect"
	setStatus("Connecting to the local read-only bridge...")

	task.spawn(function()
		while connected do
			sendSnapshot()
			task.wait(POLL_INTERVAL)
		end
	end)
end

toolbarButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

connectButton.MouseButton1Click:Connect(function()
	if connected then
		disconnect()
	else
		connect()
	end
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	if not widget.Enabled and connected then
		disconnect()
	end
end)
