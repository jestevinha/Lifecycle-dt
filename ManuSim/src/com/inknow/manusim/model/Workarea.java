package com.inknow.manusim.model;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.DBIO;
import com.inknow.manusim.view.ColorLevel;

/** Workarea is the object representing a production sector in the plant. 
 *
 * @author Rui Neves-Silva
 * @version 2.0 Build 0002 Oct-2019.
 */

public class Workarea {

	private PlantModel parent;
	//
	// parameters
	private int id; // the id=rc is composed by the row r and column c in {2,4,6,8}
	//
	private Unit unitA;
	private Unit unitB;
	private Unit unitC;
	//
	private double currPower;
	private int numberAccidents;
	// state
	private int workLocationIndex;
	private Actor currActor;	
	//
	private double lightLevel;
	private double skyExposure;
	//
	private int status;
	private double currRate;

	// constructors
	
	public Workarea() {
		this.parent = null;
		this.id = -1;
		this.numberAccidents = 0;
		this.unitA = new Unit();
		this.unitB = new Unit();
		this.unitC = new Unit();
		this.currPower = 0.0;
		this.currActor = new Actor();
		//
		this.lightLevel = 0.0;	// dynamic with day time	
		this.skyExposure = 0.0;	// static with the position 
		//
		this.status = Const.STATUS_ON;
		this.currRate = 0.0;
	}

	public Workarea(PlantModel parent, int id, int workLocationIndex) {
		this.parent = parent;
		this.id = id;
		this.numberAccidents = 0;
		this.workLocationIndex = workLocationIndex;
		this.unitA = new Unit();
		this.unitB = new Unit();
		this.unitC = new Unit();
		this.currPower = 0.0;
		this.currActor = new Actor();
		//
		this.lightLevel = 0.0;		
		this.skyExposure = this.setSkyExposure( id );
		this.status = Const.STATUS_ON;
		this.currRate = Const.RATE_FULL / 2.0; // TODO
	}

	// other methods

	public void simulateStep( ContextModel contextModel, int shifttime ) {
		double rawMaterialQuality = contextModel.getRawMaterialQuality();
		this.setLightLevel( contextModel.getClockMinutes() );
		//
		this.unitA.simulateStepUnitA( this.status, this.currRate, rawMaterialQuality );
		this.unitB.simulateStepUnitB( this.status, this.currRate, shifttime, this.lightLevel, this.currActor);
		this.unitC.simulateStepUnitC( this.status, this.currRate, contextModel.getAmbTemperature(), rawMaterialQuality, this.currActor );
		//
		this.currPower =  this.unitA.getCurrPower();
		this.currPower += this.unitB.getCurrPower();
		this.currPower += this.unitC.getCurrPower();
		return;
	}

	// gets&sets

	public PlantModel getParent() {
		return this.parent;
	}

	public int getId() {
		return this.id;
	}
	
	public int getNumberAccidents() {
		return this.numberAccidents;
	}
		
	public int getWorkLocationIndex() {
		return this.workLocationIndex;
	}

	public Unit getUnitA() {
		return this.unitA;
	}

	public Unit getUnitB() {
		return this.unitB;
	}

	public Unit getUnitC() {
		return this.unitC;
	}

	public Actor getCurrActor() {
		return this.currActor;
	}

	public double getLightLevel() {
		return this.lightLevel;
	}

	public double getSkyExposure() {
		return this.skyExposure;
	}

	public int getStatus() {
		return this.status;
	}

	public double getCurrPower() {
		return this.currPower;
	}
	
	public double getCurrRate() {
		return this.currRate;
	}

	//---
	
	public void setParent(PlantModel parent) {
		this.parent = parent;
		return;
	}

	public void setId(int id) {
		this.id = id;
		return;
	}

	public void setNumberAccidents(int numberAccidents) {
		this.numberAccidents = numberAccidents;
	}
	
 public void registAccident(int event_type ) {
        this.numberAccidents++;
        if ( Const.APP_DATABASE_ON && this.parent != null && this.parent.getParent() != null ) {
            long timestamp = this.parent.getParent().getContextModel().getAuditDay() * 24 * 60 + this.parent.getParent().getContextModel().getClockMinutes().getDayMinute();
            DBIO.registerEvent( timestamp, event_type, this.id, this.currActor.getId(), this.currRate, this.getParent().getCurrShiftTimeMinutes() );
        }
        // emit event to listeners (headless)
        if (this.parent != null) {
            this.parent.notifyAccidentOccurredInWorkarea(this, 1);
        }
        return;
    }
	
	public void setWorkLocationIndex(int workLocationIndex) {
		this.workLocationIndex = workLocationIndex;
		return;
	}

	public void setUnitA(Unit unitA) {
		this.unitA = unitA;
		return;
	}

	public void setUnitB(Unit unitB) {
		this.unitB = unitB;
		return;
	}

	public void setUnitC(Unit unitC) {
		this.unitC = unitC;
		return;
	}

	public void setCurrActor(Actor currActor) {
		this.currActor = currActor;
		return;
	}

 public void setCurrRate(double currRate) {
        this.currRate = currRate;
        if (this.parent != null) {
            this.parent.notifyWorkareaRateChanged(this);
        }
        return;
    }
	
	public void setLightLevel(double lightLevel) {
		this.lightLevel = lightLevel;
		return;
	}

	public void setSkyExposure(double skyExposure) {
		this.skyExposure = skyExposure;
		return;
	}
	
	private double setSkyExposure(int workareaId ) {
		int col = workareaId % 10;
		int row = workareaId / 10;		
		return ( 0.001*col + 0.038 ) * Math.pow( row - 5.25, 2) + 0.05 * col; // check slide...
	}

	public void setLightLevel(DayTime dayTime) {
		this.lightLevel = ColorLevel.getNaturalLightLevel(dayTime, this.skyExposure);
		return;
	}
	
 public void setStatus(int status) {
        this.status = status;
        if (this.parent != null) {
            this.parent.notifyWorkareaStatusChanged(this);
        }
        return;
    }

}
