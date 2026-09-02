package com.inknow.manusim.control;

import java.awt.Color;

public class Const {
	
	// GENERAL CONSTANTS
	public static final int NULL_CODE = 0;
	public static final int ERROR_CODE = -1;
	public static final Color INKNOW_RED = new Color( 200, 23, 7);
	
	// ECONOMIC DATA
	public static final double EUR_KWH = 0.18;
	
	// CONTROL FRAME - APPFRAME DATA WIDTHS & HEIGHTS - BP: BUTTON PANEL
	public static final String CONTROL_FRAME_TITLE = "ManuSim";
	public static final String CONTROL_FRAME_ICON = "pics/inknowK.png";
	//
	public static final String CONTROL_FRAME_FONT = "Segoe UI";
	public static final int CONTROL_FRAME_FONT_SIZE_NORMAL = 14;
	public static final int CONTROL_FRAME_FONT_SIZE_TITLE = 16;
	//
	public static final int CONTROL_FRAME_MONITOR = 0;
	//
	public static final int CONTROL_FRAME_X = 600;
	public static final int CONTROL_FRAME_Y = 100;
	public static final int CONTROL_FRAME_WIDTH = 950;
	public static final int CONTROL_FRAME_HEIGHT = 750;
	//
	public static final int BP_WIDTH = 100;
	public static final int BP_HEIGHT = CONTROL_FRAME_HEIGHT;
	public static final int BP_VGAP = 5;
	public static final int BP_HGAP = 2;
	public static final int BUTTON_WIDTH = 80;
	public static final int BUTTON_HEIGHT = 30;	
	public static final int COMBO_WIDTH = 130;
	public static final int COMBO_HEIGHT = 20;
	public static final int LABEL_WIDTH = 130;
	public static final int LABEL_HEIGHT = 20;
	
	// SETUP CONSTANTS - UNITS & ACTORS
	
	public static final int UNIT_POWER_RATE_MODEL_INDEX = 2;
	public static final int UNIT_EFFICIENCY_RAW_MODEL_INDEX = 0;
	public static final int UNIT_EFFICIENCY_TEMPERATURE_MODEL_INDEX = 0;
	public static final int UNIT_WEAR_RAW_MODEL_INDEX = 0;
	public static final int UNIT_EFFICIENCY_EXPERTISE_MODEL_INDEX = 0;
	public static final int UNIT_WEAR_EXPERTISE_MODEL_INDEX = 0;
	//
	public static final int ACTOR_SAFETY_EXPERTISE_MODEL_INDEX = 0;
	public static final int ACTOR_SAFETY_LIGHT_MODEL_INDEX = 0;
	public static final int ACTOR_SAFETY_SHIFTTIME_MODEL_INDEX = 0;
	public static final int ACTOR_SAFETY_RATE_MODEL_INDEX = 3;  // wmin=0.50: exp decay makes very_high riskier than medium
	//
	public static final double EXPERT_TYPE0_M = 4.0; 
	public static final double EXPERT_TYPE0_E = 3.0; 
	public static final double EXPERT_TYPE0_I = 4.0; 
	public static final double EXPERT_TYPE0_S = 5.0; 
	//
	public static final double EXPERT_TYPE1_M = 5.0; 
	public static final double EXPERT_TYPE1_E = 3.0; 
	public static final double EXPERT_TYPE1_I = 1.0; 
	public static final double EXPERT_TYPE1_S = 5.0; 
	//
	public static final double EXPERT_TYPE2_M = 3.0; 
	public static final double EXPERT_TYPE2_E = 5.0; 
	public static final double EXPERT_TYPE2_I = 3.0; 
	public static final double EXPERT_TYPE2_S = 4.0; 
	//
	public static final double EXPERT_TYPE3_M = 1.0; 
	public static final double EXPERT_TYPE3_E = 3.0; 
	public static final double EXPERT_TYPE3_I = 5.0; 
	public static final double EXPERT_TYPE3_S = 3.0; 
	//
	public static final int EXPONENTIAL_MODEL_GROWTH = 0;
	public static final int EXPONENTIAL_MODEL_DECAY = 1;
	
	// SIMULATOR CONSTANTS

	// Simulation time-step size in minutes. Default 60 (8 steps/shift).
	// Override via -Dmanusim.tsSimMinutes=10 (48 steps/shift) for higher-resolution
	// accident-trial dynamics during recalibration / Part A experiments.
	public static final int TS_SIM_MINUTES =
			Integer.parseInt(System.getProperty("manusim.tsSimMinutes", "60"));
	//
	public static final int TS_SIM_MS_MIN = 100;
	public static final int TS_SIM_MS_MAX = 1000;
	//
	public static final int TS_TIMER_MS = 1000;
	public static final int TS_TIMER_FF_MS = 10;
	
	// WEEKDAYS
	
	public static final int MONDAY = 0;
	public static final int TUESDAY = 1;
	public static final int WEDNESDAY = 2;
	public static final int THURSDAY = 3;
	public static final int FRIDAY = 4;
	public static final int SATURDAY = 5;
	public static final int SUNDAY = 6;
	
	// CONTEXT MODEL CONSTANTS
	
	public static final int AMB_TEMPERATURE_PEAK_HH = 16; // temperature peak at 16:00
	
	// PLANT MODEL CONSTANTS
	
	// UNIT STATUS
	public static final int STATUS_OFF = 0;
	public static final int STATUS_ON = 1;
	public static final int STATUS_FAILURE = 2;
	public static final int STATUS_MAINTENANCE = 3;
	public static final int STATUS_ACCIDENT = 4;
	//
	public static final int RATE_MINIMUM_PC = 5;	// PC stands for %
	public static final double RATE_OFF = -1.0;		// Stopped - turned OFF
	public static final double RATE_IDLE = 0.0;		// Stopped - turned ON
	public static final double RATE_FULL = 1.0;		// Full speed
	
	// UNIT TYPES
	public static final int N_UNIT_TYPES = 3;
	//
	public static final int UNIT_A= 1;
	public static final int UNIT_A1 = 11;
	public static final int UNIT_A2 = 12;
	public static final int UNIT_A3 = 13;
	//
	public static final int UNIT_B= 2;
	public static final int UNIT_B1 = 21;
	public static final int UNIT_B2 = 22;
	public static final int UNIT_B3 = 23;
	//
	public static final int UNIT_C= 3;
	public static final int UNIT_C1 = 31;
	public static final int UNIT_C2 = 32;
	public static final int UNIT_C3 = 33;
	
	// UNIT POWERS
	public static final double POWER_MAX_UNIT_A = 20E3; // W
	public static final double POWER_ON_UNIT_A = 2E3; // W
	//
	public static final double POWER_MAX_UNIT_B = 10E3; // W
	public static final double POWER_ON_UNIT_B = 0E3; // W
	//
	public static final double POWER_MAX_UNIT_C = POWER_MAX_UNIT_A / 2; // W
	public static final double POWER_ON_UNIT_C = 0E3; // W
	//
	public static final double POWER_MAX_WORKAREA = POWER_MAX_UNIT_A + 2*POWER_MAX_UNIT_B + 2*POWER_MAX_UNIT_C;
	
	// WEAR & MAINTENANCE
	public static final double NO_PARTS_WEAR_BREAKDOWN = 3 * 24 * 60 * RATE_FULL; // 10 days in optimal conditions full rate;
	public static final double PERIOD_MAINTENANCE_MINUTES = 8 * 60.0; // 8 hours
	// When true, each Unit's wear is initialised to a uniform random fraction of
	// NO_PARTS_WEAR_BREAKDOWN (legacy behaviour). When false (default), wear starts
	// at 0 so episodes begin in a known state — required for clean RL learning signal.
	// May be overridden by system property -Dmanusim.initialWearRandom=true|false.
	public static final boolean INITIAL_WEAR_RANDOM =
			Boolean.parseBoolean(System.getProperty("manusim.initialWearRandom", "false"));
	
	// SAFETY PROBABILITY FRAMES
	
	public static final double SAFETY_GAUSSIAN_STDDEV = 3.5;
	//
	public static final double SFTY_EXPERT_MIN_EXPERT = 0.0;
	public static final double SFTY_EXPERT_MIN_SFTY = 0.0;
	public static final double SFTY_LIGHT_MIN_LIGHT = 0.5;
	public static final double SFTY_LIGHT_MIN_SFTY = 0.0;
	public static final double SFTY_SHIFT_MIN_SHIFT = 0.0;
	public static final double SFTY_SHIFT_MIN_SFTY = 0.0;
	public static final double SFTY_RATE_MIN_RATE = 0.5;
	public static final double SFTY_RATE_MIN_SFTY = 0.5;
	
	// CONTEXT MODEL
	
	// RAW MATERIAL QUALITY - GAUSSIAN RANDOM
	public static final int RAW_MAT_RND_SEED = 12345;
	public static final double RAW_MAT_AVG_SPEC = 0.50;
	public static final double RAW_MAT_SDV_SPEC = 0.30;
	public static final double RAW_MAT_MAX_SPEC = 1.00;
	public static final double RAW_MAT_MIN_SPEC = 0.00;
	
	// AMBIENT TEMPERATURE
	public static final double TEMP_MIN = 10.0;
	public static final double TEMP_MAX = 30.0;
	public static final double TEMP_INIT = 10.0;
	public static final double TEMP_AMB_AVG = 20.0;
	public static final double TEMP_AMB_AMP = 10.0; // x2 to get MAX-MIN in one day 
	public static final double RANDOM_TEMPERATURE = 0.3; // Standard deviation in deg Celsius
	
	// EXPERTISE
	public static final int N_EXPERTISE_TOPICS = 4;	// Number of technologies to define expertise vector
	// Mechanical / Electrical / Internet / Safety
	public static final double EXPERTISE_MAX = 5.0;
	public static final double EXPERTISE_MIN = 1.0;
	public static final int EXPERTISE_SAFETY_INDEX = N_EXPERTISE_TOPICS - 1;

	// ACTORS
	public static final int N_ACTOR_TYPES = 4;
	public static final String TEAM_NAMES = "ABCD";
	//
	public static final int ACTOR_TYPE_A = 100;
	public static final int ACTOR_TYPE_B = 200;
	public static final int ACTOR_TYPE_C = 300;
	public static final int ACTOR_TYPE_D = 400;
	
	// EVENTS
	public static final int EVENT_TYPE_ACCIDENT = 10;
	public static final int EVENT_TYPE_ACCIDENT_EXPERTISE = EVENT_TYPE_ACCIDENT + 1;
	public static final int EVENT_TYPE_ACCIDENT_LIGHTLEVEL = EVENT_TYPE_ACCIDENT + 2;
	public static final int EVENT_TYPE_ACCIDENT_SHIFTTIME = EVENT_TYPE_ACCIDENT + 3;
	public static final int EVENT_TYPE_ACCIDENT_PRODUCTIONRATE = EVENT_TYPE_ACCIDENT + 4;
	
	public static final int EVENT_TYPE_FAILURE = 20;
		
	// ------------------------------------------------------------------
	// VIEW 
	// ------------------------------------------------------------------
	
	// VIEW FRAME
	public static final String VIEW_FRAME_TITLE = "ManuSim - manufacturing shopfloor simulation";
	public static final String VIEW_FRAME_ICON = "pics/inknowK.png";
	public static final String VIEW_LOGO_ICON = "pics/manusim-logo_.png";
	
	public static final int VIEW_FRAME_FONT_SIZE_HUGE = 60;
	public static final int VIEW_FRAME_FONT_SIZE_LARGE = 50;
	public static final int VIEW_FRAME_FONT_SIZE_MEDIUM = 30;
	//
	public static final int VIEW_FRAME_X = 100;
	public static final int VIEW_FRAME_Y = 140;
	public static final int VIEW_FRAME_WIDTH = 1920+6;
	public static final int VIEW_FRAME_HEIGHT = 1080+35;
	
	public static final int VIEW_FRAME_MONITOR = 0;
	
	public static final int SKYLEFT_PANEL_WIDTH = 14;
	public static final int SKYLEFT_PANEL_HEIGHT = 1080;
	public static final int SKYTOP_PANEL_WIDTH = 1450;
	public static final int SKYTOP_PANEL_HEIGHT = 28;
	public static final int SKYRIGHT_PANEL_WIDTH = 1920 - SKYLEFT_PANEL_WIDTH - SKYTOP_PANEL_WIDTH;
	public static final int SKYRIGHT_PANEL_HEIGHT = SKYLEFT_PANEL_HEIGHT;
	public static final int SKYBOTTOM_PANEL_WIDTH = SKYTOP_PANEL_WIDTH;
	public static final int SKYBOTTOM_PANEL_HEIGHT = 32;
	
	// PLANT PANEL
	public static final int PLANT_PANEL_TOTAL_DISPLAY_GAP = 20;
	public static final int PLANT_PANEL_TOTAL_DISPLAY_WIDTH = 385;
	public static final int PLANT_PANEL_TOTAL_DISPLAY_HEIGHT = 50;

	// WORKAREA PANE
	public static final String BACK_WORKAREA_FILE = "pics/Workarea.png";
	//
	// Workarea pane coordinates X,Y
	// x = (id%10)*WORKAREA_COORDINATES_M_X - WORKAREA_COORDINATES_B_X;
	// y = (id/10)*WORKAREA_COORDINATES_M_Y - WORKAREA_COORDINATES_B_Y;
	public static final int WORKAREA_COORDINATES_M_X = 160;
	public static final int WORKAREA_COORDINATES_B_X = 200;
	public static final int WORKAREA_COORDINATES_M_Y = 110;
	public static final int WORKAREA_COORDINATES_B_Y = 100;
	
	// Status icon in workarea pane
	public static final int STATUS_X = 125;
	public static final int STATUS_Y = 130;
	public static final int STATUS_WIDTH = 45;
	public static final int STATUS_HEIGHT = 45;
	
	public static final String STATUS_OFF_FILE = "pics/Status-OFF.png";
	public static final String STATUS_ON_FILE = "pics/Status-ON.png";
	public static final String STATUS_FAILURE_FILE = "pics/Status-Failure.png";
	public static final String STATUS_MAINTENANCE_FILE = "pics/Status-Maintenance.png";
	public static final String STATUS_ACCIDENT_FILE = "pics/Status-Accident.png";
	
	// DISPLAY PANEL
	
	public static final int PANEL_DP_X = 175;
	public static final int PANEL_DP_Y = 5;
	public static final int PANEL_DP_WIDTH = 100;
	public static final int PANEL_DP_HEIGHT = 170;
	public static final int LABEL_DP_WIDTH = 45;
	public static final int LABEL_DP_HEIGHT = 10;
	public static final int LABEL_DP_GAP = 5;
	
	// UNIT LABEL
	
	public static final int UNIT_A_WA_X = 10;
	public static final int UNIT_A_WA_Y = 10;
	//
	public static final int UNIT_B_WA_X = 10;
	public static final int UNIT_B_WA_Y = 70;
	//
	public static final int UNIT_C_WA_X = 125;
	public static final int UNIT_C_WA_Y = 10;
	
	public static final String UNIT_A1_ON_FILENAME = "pics/PU-A1.png";
	public static final String UNIT_A1_OFF_FILENAME = "pics/PU-A-OFF.png";
	public static final String UNIT_A2_ON_FILENAME = "pics/PU-A2.png";
	public static final String UNIT_A2_OFF_FILENAME = "pics/PU-A-OFF.png";
	public static final String UNIT_A3_ON_FILENAME = "pics/PU-A3.png";
	public static final String UNIT_A3_OFF_FILENAME = "pics/PU-A-OFF.png";
	//
	public static final String UNIT_B1_ON_FILENAME = "pics/PU-B1.png";
	public static final String UNIT_B1_OFF_FILENAME = "pics/PU-B-OFF.png";
	public static final String UNIT_B2_ON_FILENAME = "pics/PU-B2.png";
	public static final String UNIT_B2_OFF_FILENAME = "pics/PU-B-OFF.png";
	public static final String UNIT_B3_ON_FILENAME = "pics/PU-B3.png";
	public static final String UNIT_B3_OFF_FILENAME = "pics/PU-B-OFF.png";
	//	
	public static final String UNIT_C1_ON_FILENAME = "pics/PU-C1.png";
	public static final String UNIT_C1_OFF_FILENAME = "pics/PU-C-OFF.png";
	public static final String UNIT_C2_ON_FILENAME = "pics/PU-C2.png";
	public static final String UNIT_C2_OFF_FILENAME = "pics/PU-C-OFF.png";
	public static final String UNIT_C3_ON_FILENAME = "pics/PU-C3.png";
	public static final String UNIT_C3_OFF_FILENAME = "pics/PU-C-OFF.png";
	
	// ACTOR LABEL
	
	public static final String ACTOR_PREFIX_FILENAME = "pics/Actor-";
	public static final String ACTOR_SUFFIX_FILENAME = ".png";
	public static final int ACTOR_LOCATION_WORKAREA_X = 25;
	public static final int ACTOR_LOCATION_WORKAREA_Y = 118;
	
	// LOCATION
	
	public static final int N_LOCATIONS = 48;
	
	// SHIFTTIME DURATIOn
	
	public static final int SHIFTTIME_MINUTES = 8*60;	// minutes
		
    // SQL DB 
	
	public static final boolean APP_DATABASE_ON = true;
	public static final String JDBC_DRIVER_FORNAME = "com.mysql.jdbc.Driver";
	public static final String JDBC_HOST_PATH = "jdbc:mysql://localhost:3306/manusim?useSSL=false";
    public static final String JDBC_HOST_USERNAME = "root";
    public static final String JDBC_HOST_PASSWORD = "PassWordle";
	
	
	
	
}
