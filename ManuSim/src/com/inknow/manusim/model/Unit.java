package com.inknow.manusim.model;

import java.util.Random;

//import java.text.DecimalFormat;

import com.inknow.manusim.control.Const;

/** Unit is the object representing a generic equipment. 
*
* @author Rui Neves-Silva
* @version 2.0 Build 0002 Oct-2019.
*/

public class Unit {
	
	private Workarea parent; 
	
	// parameters
	private int id;
	private int type;	// Use Const.UNIT_X0 where X is letter (A,B,C) for the type and 0 for the generation
	private int workareaId;
	//
	private Random unitRandom;
	//
	private double powerMax;
	// state
	private double powerOn;
	private double currPower;
	
	// Models for type A, B & C
	private Expertise technology;
	// Unit A
	private ParabolicModel powerRateCurve;
	private ParabolicModel efficiencyRawCurve;
	// Unit B
	private ExponentialModel efficiencyExpertiseCurve;
	private ExponentialModel safetyExpertiseCurve;
	private ExponentialModel safetyLightCurve;
	private ExponentialModel safetyShifttimeCurve;
	private ExponentialModel safetyRateCurve;
	// Unit C
	private ParabolicModel efficiencyTemperatureCurve;
	private ParabolicModel wearRawCurve;
	private ExponentialModel wearExpertiseCurve;
	
	private double wearStatus;
	private double maintenanceTime;
	
	// constructors
	
	public Unit() {
		super();
		this.parent = null; // later defined in PlantModel.installUnits2Workareas()
		this.id = -1;
		this.type = -1;
		this.workareaId = -1;
		this.unitRandom = new Random();
		this.powerMax = 0.0;
		this.powerOn = 0.0;
		this.currPower = 0.0;
		this.powerRateCurve = new ParabolicModel();
		this.efficiencyRawCurve = new ParabolicModel();
		this.efficiencyTemperatureCurve = new ParabolicModel();
		this.wearRawCurve = new ParabolicModel();
		this.efficiencyExpertiseCurve = new ExponentialModel();
		this.safetyExpertiseCurve = new ExponentialModel();
		this.safetyLightCurve = new ExponentialModel();
		this.safetyShifttimeCurve = new ExponentialModel();
		this.wearExpertiseCurve = new ExponentialModel();
		this.technology = new Expertise();
		this.wearStatus = 0.0;
		this.maintenanceTime = 0.0;
	}
	
	public Unit(int id, int type,  int workareaId ) {
		this.parent = null;
		this.id = id;
		this.type = type;
		this.workareaId = workareaId;
		this.unitRandom = new Random( this.id * this.workareaId );
		//
		int masterType = ( this.type / 10 );
		switch(masterType) {
		case Const.UNIT_A:
			this.powerMax = Const.POWER_MAX_UNIT_A;
			this.powerOn = Const.POWER_ON_UNIT_A;
			break;
		case Const.UNIT_B:
			this.powerMax = Const.POWER_MAX_UNIT_B;
			this.powerOn = Const.POWER_ON_UNIT_B;
			break;
		case Const.UNIT_C:
			this.powerMax = Const.POWER_MAX_UNIT_C;
			this.powerOn = Const.POWER_ON_UNIT_C;
			break;
		default:
			this.powerMax = 0.0;
			this.powerOn = 0.0;
		}
		this.currPower = 0.0;
		// Type A
		this.powerRateCurve = new ParabolicModel();
		this.efficiencyRawCurve = new ParabolicModel();
		// Type B
		this.technology = new Expertise();
		this.efficiencyExpertiseCurve = new ExponentialModel();
		this.safetyExpertiseCurve = new ExponentialModel();
		this.safetyLightCurve = new ExponentialModel();
		this.safetyShifttimeCurve = new ExponentialModel();
		// Type C
		this.efficiencyTemperatureCurve = new ParabolicModel();
		this.wearRawCurve = new ParabolicModel();
		this.wearExpertiseCurve = new ExponentialModel();
		//
		this.wearStatus = this.unitRandom.nextDouble() * Const.NO_PARTS_WEAR_BREAKDOWN; // randomize initial wear with position
		this.maintenanceTime = 0.0;
	}
	
	// other methods
	
	public void simulateStepUnitA( int status, double currRate, double rawMaterialQuality ) {
		switch ( status ) {
		case Const.STATUS_ON:
			// energy & efficiency
			this.currPower = this.powerOn + ( this.powerMax - this.powerOn ) 
					* this.powerRateCurve.computeOutput( currRate ) 									// M01A
					/ this.efficiencyRawCurve.computeOutput(rawMaterialQuality);						// M02A
			break;
		case Const.STATUS_FAILURE:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		case Const.STATUS_MAINTENANCE:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		case Const.STATUS_ACCIDENT:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		default:
		}
		return;
	}
	
	public void simulateStepUnitB( int status, double currRate, int shifttime, double lightLevel, Actor currActor ) {
		switch ( status ) {
		case Const.STATUS_ON:
			// energy & efficiency
			double expertiseSimilarity = this.technology.similarity( currActor.getExpertise() );
			this.currPower = this.powerOn + currRate * ( this.powerMax - this.powerOn )
					/ this.efficiencyExpertiseCurve.computeOutput( expertiseSimilarity );				// M05B
			// safety & accidents TODO
			double shifttime_normed = (double) shifttime / Const.SHIFTTIME_MINUTES;
			double  sftyExpThr = this.safetyExpertiseCurve.computeOutputFramed( expertiseSimilarity, Const.SFTY_EXPERT_MIN_EXPERT, 1.0, Const.SFTY_EXPERT_MIN_SFTY, 1.0 );
			double  sftyLightThr = this.safetyLightCurve.computeOutputFramed( lightLevel, Const.SFTY_LIGHT_MIN_LIGHT, 1.0, Const.SFTY_LIGHT_MIN_SFTY, 1.0 );
			double  sftyShiftThr = this.safetyShifttimeCurve.computeOutputFramed( shifttime_normed, Const.SFTY_SHIFT_MIN_SHIFT, 1.0, Const.SFTY_SHIFT_MIN_SFTY, 1.0 );
			double  sftyRateThr = this.safetyRateCurve.computeOutputFramed( currRate, Const.SFTY_RATE_MIN_RATE, 1.0, Const.SFTY_RATE_MIN_SFTY, 1.0 );
//			if ( this.getNextGaussian() > sftyExpThr ) { // M06H
//				this.parent.setStatus( Const.STATUS_ACCIDENT );
//				currActor.setStatus( Const.STATUS_ACCIDENT );
//				this.parent.registAccident( Const.EVENT_TYPE_ACCIDENT_EXPERTISE );
//			} else if ( this.getNextGaussian() > sftyLightThr ) { // M07H
//				this.parent.setStatus( Const.STATUS_ACCIDENT );
//				currActor.setStatus( Const.STATUS_ACCIDENT );
//				this.parent.registAccident( Const.EVENT_TYPE_ACCIDENT_LIGHTLEVEL );
//			} else if (this.getNextGaussian() > sftyShiftThr ) { // M08H
//				this.parent.setStatus( Const.STATUS_ACCIDENT );
//				currActor.setStatus( Const.STATUS_ACCIDENT );
//				this.parent.registAccident( Const.EVENT_TYPE_ACCIDENT_SHIFTTIME );
//			} else if ( this.getNextGaussian() > sftyRateThr ) { // M09H
//				this.parent.setStatus( Const.STATUS_ACCIDENT );
//				currActor.setStatus( Const.STATUS_ACCIDENT );
//				this.parent.registAccident( Const.EVENT_TYPE_ACCIDENT_PRODUCTIONRATE );
//			}
			int eventType = Const.NULL_CODE;
			if ( this.getNextGaussian() > sftyExpThr ) { // M06H
				this.parent.setStatus( Const.STATUS_ACCIDENT );
				currActor.setStatus( Const.STATUS_ACCIDENT );
				eventType = ( eventType == Const.NULL_CODE ? Const.EVENT_TYPE_ACCIDENT_EXPERTISE : Const.EVENT_TYPE_ACCIDENT );
			}
			if ( this.getNextGaussian() > sftyLightThr ) { // M07H
				this.parent.setStatus( Const.STATUS_ACCIDENT );
				currActor.setStatus( Const.STATUS_ACCIDENT );
				eventType = ( eventType == Const.NULL_CODE ? Const.EVENT_TYPE_ACCIDENT_LIGHTLEVEL : Const.EVENT_TYPE_ACCIDENT );
			} 
			if (this.getNextGaussian() > sftyShiftThr ) { // M08H
				this.parent.setStatus( Const.STATUS_ACCIDENT );
				currActor.setStatus( Const.STATUS_ACCIDENT );
				eventType = ( eventType == Const.NULL_CODE ? Const.EVENT_TYPE_ACCIDENT_SHIFTTIME : Const.EVENT_TYPE_ACCIDENT );
			}
			if ( this.getNextGaussian() > sftyRateThr ) { // M09H
				this.parent.setStatus( Const.STATUS_ACCIDENT );
				currActor.setStatus( Const.STATUS_ACCIDENT );
				eventType = ( eventType == Const.NULL_CODE ? Const.EVENT_TYPE_ACCIDENT_PRODUCTIONRATE : Const.EVENT_TYPE_ACCIDENT );
			}
			if ( this.getNextGaussian() > 0.90 ) eventType = Const.EVENT_TYPE_ACCIDENT; // TODO
			if ( eventType != Const.NULL_CODE ) this.parent.registAccident( eventType );
			break;
		case Const.STATUS_FAILURE:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		case Const.STATUS_MAINTENANCE:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		case Const.STATUS_ACCIDENT:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		default:
		}
		return;
	}
	
	private double getNextGaussian() {
		double nextGaussian = Math.abs( this.unitRandom.nextGaussian() / Const.SAFETY_GAUSSIAN_STDDEV );
		nextGaussian = nextGaussian > 1.0 ? 1.0 : nextGaussian;
		return nextGaussian;
	}
	
	public void simulateStepUnitC( int status,  double currRate, double ambTemperature, double rawMaterialQuality, Actor currActor ) {
		switch ( status ) {
		case Const.STATUS_ON:
			// energy & efficiency
			double temperature = ( ambTemperature - Const.TEMP_MIN ) / ( Const.TEMP_MAX - Const.TEMP_MIN );
			this.currPower = this.powerOn + ( this.powerMax - this.powerOn ) 
					* currRate
					/ this.efficiencyTemperatureCurve.computeOutput( temperature );						// M03C
			// wear & maintenance
			double expertiseSimilarity = this.technology.similarity( currActor.getExpertise() );
			this.wearStatus += this.powerRateCurve.computeOutput( currRate ) * Const.TS_SIM_MINUTES 	// M01A/M04C (friction effect)
					/ this.wearRawCurve.computeOutput( rawMaterialQuality )								// M02C
					/ this.wearExpertiseCurve.computeOutput( expertiseSimilarity );						// M05C
			if ( this.wearStatus >= Const.NO_PARTS_WEAR_BREAKDOWN ) {
				this.parent.setStatus( Const.STATUS_FAILURE );
				this.maintenanceTime = 0.0;
			}
			break;
		case Const.STATUS_FAILURE:
			this.parent.setCurrRate( 0.0 );
			this.maintenanceTime = 0.0;
			this.currPower = 0.0;
			break;
		case Const.STATUS_MAINTENANCE:
			this.parent.setCurrRate( 0.0 );
			this.maintenanceTime += Const.TS_SIM_MINUTES;
			if (this.maintenanceTime >= Const.PERIOD_MAINTENANCE_MINUTES * 4) {
				this.parent.setStatus( Const.STATUS_ON );
				this.wearStatus = 0.0;
			}
			this.currPower = 0.0;
			break;
		case Const.STATUS_ACCIDENT:
			this.parent.setCurrRate( 0.0 );
			this.currPower = 0.0;
			break;
		default:
		} 
		return;
	}

	// gets & sets
	
	public Workarea getParent() {
		return parent;
	}

	public int getId() {
		return id;
	}

	public int getType() {
		return type;
	}

	public String getTypeString() {
		switch(this.type){
		case Const.UNIT_A1:
			return "A1";
		case Const.UNIT_A2:
			return "A2";
		case Const.UNIT_A3:
			return "A3";
		case Const.UNIT_B1:
			return "B1";
		case Const.UNIT_B2:
			return "B2";
		case Const.UNIT_B3:
			return "B3";
		case Const.UNIT_C1:
			return "C1";
		case Const.UNIT_C2:
			return "C2";
		case Const.UNIT_C3:
			return "C3";
		default:
			return "";	
		}
	}
	
	public int getWorkareaId() {
		return this.workareaId;
	}

	public double getPowerMax() {
		return this.powerMax;
	}

	public double getPowerOn() {
		return this.powerOn;
	}

	public double getCurrPower() {
		return this.currPower;
	}

	public Expertise getTechnology() {
		return this.technology;
	}

	public ParabolicModel getPowerRateCurve() {
		return this.powerRateCurve;
	}

	public ParabolicModel getEfficiencyRawCurve() {
		return this.efficiencyRawCurve;
	}

	public ExponentialModel getEfficiencyExpertiseCurve() {
		return this.efficiencyExpertiseCurve;
	}

	public ParabolicModel getEfficiencyTemperatureCurve() {
		return this.efficiencyTemperatureCurve;
	}
	
	public ExponentialModel getSafetyExpertiseCurve() {
		return safetyExpertiseCurve;
	}

	public ExponentialModel getSafetyLightCurve() {
		return safetyLightCurve;
	}

	public ExponentialModel getSafetyShifttimeCurve() {
		return safetyShifttimeCurve;
	}

	public ExponentialModel getSafetyRateCurve() {
		return safetyRateCurve;
	}

	public ParabolicModel getWearRawCurve() {
		return this.wearRawCurve;
	}

	public ExponentialModel getWearExpertiseCurve() {
		return this.wearExpertiseCurve;
	}

	public double getWearStatus() {
		return this.wearStatus;
	}

	public double getMaintenanceTime() {
		return this.maintenanceTime;
	}

	//--
	
	public void setParent(Workarea parent) {
		this.parent = parent;
		return;
	}

	public void setId(int id) {
		this.id = id;
		return;
	}

	public void setType(int type) {
		this.type = type;
		return;
	}

	public void setWorkareaId(int workareaId) {
		this.workareaId = workareaId;
		return;
	}

	public void setPowerMax(double powerMax) {
		this.powerMax = powerMax;
		return;
	}

	public void setPowerOn(double powerOn) {
		this.powerOn = powerOn;
		return;
	}

	public void setCurrPower(double currPower) {
		this.currPower = currPower;
		return;
	}

	public void setTechnology(Expertise technology) {
		this.technology = technology;
		return;
	}

	public void setPowerRateCurve(ParabolicModel powerRateCurve) {
		this.powerRateCurve = powerRateCurve;
		return;
	}

	public void setEfficiencyRawCurve(ParabolicModel efficiencyRawCurve) {
		this.efficiencyRawCurve = efficiencyRawCurve;
		return;
	}

	public void setEfficiencyExpertiseCurve(ExponentialModel efficiencyExpertiseCurve) {
		this.efficiencyExpertiseCurve = efficiencyExpertiseCurve;
		return;
	}

	public void setSafetyExpertiseCurve(ExponentialModel safetyExpertiseCurve) {
		this.safetyExpertiseCurve = safetyExpertiseCurve;
		return;
	}
	
	public void setSafetyLightCurve(ExponentialModel safetyLightCurve) {
		this.safetyLightCurve = safetyLightCurve;
		return;
	}
	
	public void setSafetyShifttimeCurve(ExponentialModel safetyShifttimeCurve) {
		this.safetyShifttimeCurve = safetyShifttimeCurve;
		return;
	}
	
	public void setSafetyRateCurve(ExponentialModel safetyRateCurve) {
		this.safetyRateCurve = safetyRateCurve;
		return;
	}
	
	public void setEfficiencyTemperatureCurve(ParabolicModel efficiencyTemperatureCurve) {
		this.efficiencyTemperatureCurve = efficiencyTemperatureCurve;
		return;
	}

	public void setWearRawCurve(ParabolicModel wearRawCurve) {
		this.wearRawCurve = wearRawCurve;
		return;
	}

	public void setWearExpertiseCurve(ExponentialModel wearExpertiseCurve) {
		this.wearExpertiseCurve = wearExpertiseCurve;
		return;
	}

	public void setWearStatus(double wearStatus) {
		this.wearStatus = wearStatus;
		return;
	}

	public void setMaintenanceTime(double maintenanceTime) {
		this.maintenanceTime = maintenanceTime;
		return;
	}
		
} // EOF
