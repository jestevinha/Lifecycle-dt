package com.inknow.manusim.model;

import java.util.Random;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.Simulator;

public class ContextModel {
	
	private Simulator parent;
	//
	Random rand = new Random();
	//
	private int auditDay;
	private int weekDay;
	//
	private DayTime clockMinutes;
	//
	private double ambTemperature;
	//
	private double rawMaterialQuality;
	
	// constructors
	
 public ContextModel(Simulator parent) {
        this.parent = parent;
        this.rand.setSeed( Const.RAW_MAT_RND_SEED );
        this.auditDay = 1;
        this.weekDay = Const.MONDAY;
        this.clockMinutes = new DayTime( 00,00 );
        this.ambTemperature = Weather.getAmbTemp( this.clockMinutes );
        this.rawMaterialQuality = Const.RAW_MAT_AVG_SPEC;
    }

    public ContextModel(Simulator parent, long seed) {
        this(parent);
        this.rand.setSeed(seed);
    }
	
	// other methods
	
	public void simulateStep() {
		// update time variables
		Boolean dayInc = this.clockMinutes.addMinutes( Const.TS_SIM_MINUTES );
		if (dayInc) {
			this.auditDay ++;
			this.weekDay ++;
			if (this.weekDay > Const.FRIDAY) { this.weekDay = Const.MONDAY; }
		}
		//
		this.ambTemperature = Weather.getAmbTemp( this.clockMinutes );
		this.ambTemperature = ( this.ambTemperature > Const.TEMP_MAX ? Const.TEMP_MAX 
				: ( this.ambTemperature < Const.TEMP_MIN ? Const.TEMP_MIN : this.ambTemperature ));
		//
		// external random excitation through the quality of the raw material
		this.rawMaterialQuality = Const.RAW_MAT_AVG_SPEC + Const.RAW_MAT_SDV_SPEC * rand.nextGaussian();
		this.rawMaterialQuality = ( this.rawMaterialQuality > Const.RAW_MAT_MAX_SPEC ? Const.RAW_MAT_MAX_SPEC 
				: ( this.rawMaterialQuality < Const.RAW_MAT_MIN_SPEC ? Const.RAW_MAT_MIN_SPEC : this.rawMaterialQuality ));
		return;
	}
	
	// gets & sets
	
	public Simulator getParent() {
		return parent;
	}
    public DayTime getClockMinutes() {
    	return this.clockMinutes;
    }
    
    public int getAuditDay() {
    	return this.auditDay;
    }
    
    public int getWeekDay() {
    	return this.weekDay;
    }
    
    public double getAmbTemperature() {
    	return this.ambTemperature;
    }
    
	public double getRawMaterialQuality() {
		return this.rawMaterialQuality;
	}

	//--

	public void setParent(Simulator parent) {
		this.parent = parent;
		return;
	}

} // EOF
