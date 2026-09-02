package com.inknow.manusim.control;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import javax.swing.Timer;
import com.inknow.manusim.model.ContextModel;
import com.inknow.manusim.model.PlantModel;

public class Simulator implements ActionListener {

	private ControlFrame parent;
	//
	private Timer 	timerSim;			// timer device to drive the simulation
	//
	private Boolean simRunON;
	private Boolean simFastForward;
    //
    private ContextModel contextModel;
	private PlantModel plantModel;
       
    // constructors
	
	public Simulator() {
    	this.parent = null;
       	//
    	this.simRunON = false;
    	this.simFastForward = false;
    	//
    	this.contextModel = null;
    	this.plantModel = null;
    }
    
	public Simulator(ControlFrame parent) {
    	this.parent = parent;
       	//
    	this.simRunON = false;
    	this.simFastForward = true;
    	//
    	this.initTimer(); // initialize timerSim
    	this.contextModel = new ContextModel( this );
    	this.plantModel = new PlantModel( this );
    }
       
	// other methods
	
    private void initTimer() {
		this.timerSim = new Timer( Const.TS_TIMER_MS, this);
		if (this.simFastForward) {
			this.timerSim.setDelay( (int)( Const.TS_TIMER_FF_MS ) );
		} else {
			this.timerSim.setDelay( (int)( Const.TS_TIMER_MS ) );
		}
		return;
	}
    
	private void simulateStep() {
		this.contextModel.simulateStep();
		this.plantModel.simulateStep( this.contextModel );
		this.parent.getViewFrame().getPlantPanel().updateView();
		return;
	}
    	
    // exposes the simulation start action to the parent frame
	
	public void startSimulation() {
		this.timerSim.start();
		this.simRunON = true;
		return;
	}
	
	// exposes the simulation stop action to the parent frame
	public void stopSimulation() {
		this.timerSim.stop();
		this.simRunON = false;
		return;
	}
		
	// gets and sets
	
	public ControlFrame getParent() {
		return this.parent;
	}
	
	public Timer getTimerSim() {
		return this.timerSim;
	}
		
	public Boolean isSimRunON() {
		return this.simRunON;
	}
	
	public Boolean isSimFastForward() {
		return this.simFastForward;
	}
	
	public ContextModel getContextModel() {
    	return this.contextModel;
    }
    
	public PlantModel getPlant() {
		return this.plantModel;
	}
    
    //--
	
	public void setParent(ControlFrame parent) {
		this.parent = parent;
		return;
	}
    public void setSimFastForward(Boolean simFastForward) {
		this.simFastForward = simFastForward;
		if (this.simFastForward) {
			this.timerSim.setDelay( (int)( Const.TS_TIMER_FF_MS ) );
		} else {
			this.timerSim.setDelay( (int)( Const.TS_TIMER_MS ) );
		}
		return;
	}
        
	// listeners
    
	public void actionPerformed(ActionEvent e) {
    	if ( e.getSource() == this.timerSim ) {
    		this.simulateStep();
    	}
    	return;
	}

}
