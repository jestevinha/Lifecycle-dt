package com.inknow.manusim.setup;

import java.awt.Color;
import java.awt.Font;

import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JSlider;
import javax.swing.SwingConstants;
import javax.swing.event.ChangeEvent;
import javax.swing.event.ChangeListener;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.ControlFrame;

public class SetupSimulation extends JPanel implements ChangeListener {
	
	private static final long serialVersionUID = 1L;
	//
	private ControlFrame parent;
	//
	JSlider simSpeedSlider;

	// constructors
	
	public SetupSimulation() {
		super();
		this.parent = new ControlFrame();
	}
	
	public SetupSimulation(ControlFrame parent) {
		super();
		this.parent = parent;
		this.initComponents();
	}
	
	// other methods
	
	private void initComponents() {
		
		this.setLayout(null);
        this.setBackground(java.awt.SystemColor.control);
 		
        JLabel aux1Label = new JLabel("Simulation period:", SwingConstants.LEFT); 
		aux1Label.setBounds(10, 0, 150, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 14) );
		aux1Label.setForeground( Color.DARK_GRAY );
		this.add( aux1Label );
        
        simSpeedSlider = new JSlider();
        simSpeedSlider.setBounds(10, 30, 120, 30);
        simSpeedSlider.setMaximum( Const.TS_SIM_MS_MAX);
        simSpeedSlider.setMinimum( Const.TS_SIM_MS_MIN);
        simSpeedSlider.setSnapToTicks(true);
        simSpeedSlider.setPaintTicks(true);
        simSpeedSlider.setMinorTickSpacing(100);
        simSpeedSlider.setMajorTickSpacing(100);
        simSpeedSlider.setValue(Const.TS_TIMER_MS);
        simSpeedSlider.addChangeListener(this);
    	this.add(simSpeedSlider);
    	
    	this.parent.getMainTabbedPane().addTab("Simulation", this );
		
	}
	
	@Override
	public void stateChanged(ChangeEvent e) {
		if ( e.getSource() == simSpeedSlider) {
    		this.parent.getSimulator().getTimerSim().setDelay( simSpeedSlider.getValue() );
    	}
		
	}

}
